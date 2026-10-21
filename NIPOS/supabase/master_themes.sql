-- =====================================================================================================
-- NIPOS: Master themes and the hidden $YSTEM account
--
-- Safe to re-run. Adds:
--   system_theme    the one master theme every device follows (anyone may read it; nobody may write it
--                   directly - only through nipos_set_master_theme below)
--   system_secrets  the $YSTEM password hash. RLS on with no policies, so the browser can never read it.
--   is_system_user(), nipos_check_system_password(), nipos_set_master_theme(),
--   nipos_set_pos_layout()   called from Backend
--   nipos_setup_system_account()   run by hand in the SQL Editor to create $YSTEM / change its
--                                  password. Nobody can call it from the browser.
-- =====================================================================================================

create table if not exists public.system_theme (
  id     text primary key,
  theme  text not null,
  ts     bigint not null default 0,
  set_by text
);
alter table public.system_theme enable row level security;
drop policy if exists "anyone reads the master theme" on public.system_theme;
create policy "anyone reads the master theme" on public.system_theme for select to anon, authenticated using (true);
revoke insert, update, delete on public.system_theme from anon, authenticated;
grant select on public.system_theme to anon, authenticated;
insert into public.system_theme (id, theme, ts) values ('current', 'classic', 0) on conflict (id) do nothing;
-- The till layout every till uses (Backend > Master themes > Till layout).
alter table public.system_theme add column if not exists layout text not null default 'classic';

create table if not exists public.system_secrets (
  id           text primary key,
  hash         text,
  failed       int not null default 0,
  locked_until timestamptz
);
alter table public.system_secrets enable row level security;
revoke all on public.system_secrets from anon, authenticated;

-- True when the signed-in account is $YSTEM.
create or replace function public.is_system_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_users where id = auth.uid()::text and coalesce((data->>'system')::boolean, false));
$$;

-- 'ok' | 'wrong' | 'locked' | 'not_set' | 'not_system'. Five wrong passwords lock it for 15 minutes.
create or replace function public.nipos_check_system_password(p_password text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare s public.system_secrets;
begin
  if not public.is_system_user() then return 'not_system'; end if;
  select * into s from public.system_secrets where id = 'system_password' for update;
  if not found or s.hash is null then return 'not_set'; end if;
  if s.locked_until is not null and s.locked_until > now() then return 'locked'; end if;
  if s.hash = extensions.crypt(coalesce(p_password, ''), s.hash) then
    update public.system_secrets set failed = 0, locked_until = null where id = 'system_password';
    return 'ok';
  end if;
  if s.failed + 1 >= 5 then
    update public.system_secrets set failed = 0, locked_until = now() + interval '15 minutes' where id = 'system_password';
    return 'locked';
  end if;
  update public.system_secrets set failed = s.failed + 1 where id = 'system_password';
  return 'wrong';
end $$;

-- Sets the master theme for every device. Checks the password again every time.
create or replace function public.nipos_set_master_theme(p_password text, p_theme text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare r text;
begin
  r := public.nipos_check_system_password(p_password);
  if r <> 'ok' then return r; end if;
  if p_theme not in ('classic', 'neon-nights', 'classic-pub', 'modern-loft', 'electric-night', 'lounge-sunset', 'coastal-breeze') then
    return 'bad_theme';
  end if;
  insert into public.system_theme (id, theme, ts, set_by)
  values ('current', p_theme, (extract(epoch from now()) * 1000)::bigint, auth.uid()::text)
  on conflict (id) do update set theme = excluded.theme, ts = excluded.ts, set_by = excluded.set_by;
  return 'ok';
end $$;

-- Sets the till layout for every till. Checks the password again every time.
create or replace function public.nipos_set_pos_layout(p_password text, p_layout text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare r text;
begin
  r := public.nipos_check_system_password(p_password);
  if r <> 'ok' then return r; end if;
  if p_layout not in ('classic', 'tiles', 'colour', 'list', 'pubtill', 'dock') then return 'bad_layout'; end if;
  insert into public.system_theme (id, theme, layout, ts, set_by)
  values ('current', 'classic', p_layout, (extract(epoch from now()) * 1000)::bigint, auth.uid()::text)
  on conflict (id) do update set layout = excluded.layout, ts = excluded.ts, set_by = excluded.set_by;
  return 'ok';
end $$;

revoke all on function public.is_system_user() from public, anon;
revoke all on function public.nipos_set_pos_layout(text, text) from public, anon;
grant execute on function public.nipos_set_pos_layout(text, text) to authenticated, service_role;
revoke all on function public.nipos_check_system_password(text) from public, anon;
revoke all on function public.nipos_set_master_theme(text, text) from public, anon;
grant execute on function public.is_system_user() to authenticated, service_role;
grant execute on function public.nipos_check_system_password(text) to authenticated, service_role;
grant execute on function public.nipos_set_master_theme(text, text) to authenticated, service_role;

-- Master settings: every optional feature's switch and configuration, all off until $YSTEM turns them on.
alter table public.system_theme add column if not exists settings jsonb not null default '{}'::jsonb;

create or replace function public.nipos_set_system_setting(p_password text, p_key text, p_value jsonb) returns text
language plpgsql volatile security definer set search_path = public as $$
declare r text;
begin
  r := public.nipos_check_system_password(p_password);
  if r <> 'ok' then return r; end if;
  if p_key is null or p_key !~ '^[a-zA-Z][a-zA-Z0-9]{1,40}$' or p_key = 'announcementPosts' then return 'bad_key'; end if;
  update public.system_theme set settings = jsonb_set(settings, array[p_key], coalesce(p_value, 'null'::jsonb), true),
    ts = (extract(epoch from now()) * 1000)::bigint, set_by = auth.uid()::text where id = 'current';
  return 'ok';
end $$;
revoke all on function public.nipos_set_system_setting(text, text, jsonb) from public, anon;
grant execute on function public.nipos_set_system_setting(text, text, jsonb) to authenticated, service_role;

-- Message on every till. p_venue null = every venue. $YSTEM, or staff with Send Announcements for a
-- venue they work at (every venue needs Global Admin), and only while the feature is switched on.
create or replace function public.nipos_set_announcement(p_venue text, p_text text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare me jsonb; s jsonb; k text := coalesce(p_venue, '*');
begin
  select data into me from public.staff_users where id = auth.uid()::text;
  if me is null then return 'not_signed_in'; end if;
  select settings into s from public.system_theme where id = 'current';
  if not coalesce((s->'announcements'->>'enabled')::boolean, false) then return 'off'; end if;
  if not public.is_system_user() then
    if not coalesce((me->'perms'->>'sendAnnouncements')::boolean, false) then return 'no_permission'; end if;
    if p_venue is null and not coalesce((me->'perms'->>'globalAdmin')::boolean, false) then return 'no_permission'; end if;
    if p_venue is not null and not (coalesce((me->'perms'->>'globalAdmin')::boolean, false) or (me->'venueIds') ? p_venue) then return 'no_permission'; end if;
  end if;
  if coalesce(btrim(p_text), '') = '' then
    update public.system_theme set settings = settings #- array['announcementPosts', k] where id = 'current';
  else
    update public.system_theme set settings = jsonb_set(
      case when settings ? 'announcementPosts' then settings else settings || '{"announcementPosts":{}}'::jsonb end,
      array['announcementPosts', k],
      jsonb_build_object('text', left(btrim(p_text), 280), 'by', me->>'name', 'ts', (extract(epoch from now()) * 1000)::bigint), true)
    where id = 'current';
  end if;
  return 'ok';
end $$;
revoke all on function public.nipos_set_announcement(text, text) from public, anon;
grant execute on function public.nipos_set_announcement(text, text) to authenticated, service_role;

-- Notify everyone: as above, plus how it shows. 'banner' stays at the top of every screen until it's
-- taken down; 'popup' beeps and pops up on every screen (urgent). Banners need Send Announcements or
-- Notify Specific Users; pop-ups need Notify Specific Users.
create or replace function public.nipos_set_announcement(p_venue text, p_text text, p_style text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare me jsonb; s jsonb; k text := coalesce(p_venue, '*'); st text := case when p_style = 'popup' then 'popup' else 'banner' end;
  can_banner boolean; can_popup boolean;
  bucket text := case when p_style = 'popup' then 'announcementPopups' else 'announcementPosts' end;
begin
  select data into me from public.staff_users where id = auth.uid()::text;
  if me is null then return 'not_signed_in'; end if;
  select settings into s from public.system_theme where id = 'current';
  if not coalesce((s->'announcements'->>'enabled')::boolean, false) then return 'off'; end if;
  if not public.is_system_user() then
    can_popup := coalesce((me->'perms'->>'notifySpecificUsers')::boolean, false);
    can_banner := can_popup or coalesce((me->'perms'->>'sendAnnouncements')::boolean, false);
    if not can_banner or (st = 'popup' and not can_popup) then return 'no_permission'; end if;
    if p_venue is null and not coalesce((me->'perms'->>'globalAdmin')::boolean, false) then return 'no_permission'; end if;
    if p_venue is not null and not (coalesce((me->'perms'->>'globalAdmin')::boolean, false) or (me->'venueIds') ? p_venue) then return 'no_permission'; end if;
  end if;
  -- Banners and pop-ups are kept apart, so an urgent pop-up never knocks a banner down.
  if coalesce(btrim(p_text), '') = '' then
    update public.system_theme set settings = settings #- array[bucket, k] where id = 'current';
  else
    update public.system_theme set settings = jsonb_set(
      case when settings ? bucket then settings else settings || jsonb_build_object(bucket, '{}'::jsonb) end,
      array[bucket, k],
      jsonb_build_object('text', left(btrim(p_text), 280), 'by', me->>'name', 'byId', auth.uid()::text, 'style', st,
        'id', 'a' || (extract(epoch from clock_timestamp()) * 1000)::bigint, 'ts', (extract(epoch from now()) * 1000)::bigint), true)
    where id = 'current';
  end if;
  return 'ok';
end $$;
revoke all on function public.nipos_set_announcement(text, text, text) from public, anon;
grant execute on function public.nipos_set_announcement(text, text, text) to authenticated, service_role;

-- Activity log (Master settings feature): staff add entries about themselves; only $YSTEM reads it.
create table if not exists public.activity_log (
  id text primary key,
  ts bigint not null,
  venue_id text,
  user_id text,
  data jsonb not null default '{}'::jsonb
);
create index if not exists activity_log_ts on public.activity_log (ts desc);
alter table public.activity_log enable row level security;
drop policy if exists "staff log their own actions" on public.activity_log;
create policy "staff log their own actions" on public.activity_log for insert to authenticated with check (user_id = auth.uid()::text);
drop policy if exists "only $YSTEM reads the activity log" on public.activity_log;
create policy "only $YSTEM reads the activity log" on public.activity_log for select to authenticated using (public.is_system_user());
-- Staff with View Activity Logs read it too (Backend > Activity log).
drop policy if exists "View Activity Logs reads the activity log" on public.activity_log;
create policy "View Activity Logs reads the activity log" on public.activity_log for select to authenticated using (
  exists (select 1 from public.staff_users su where su.id = auth.uid()::text and coalesce((su.data->'perms'->>'viewActivityLogs')::boolean, false) and coalesce((su.data->'perms'->>'active')::boolean, true)));
grant select, insert on public.activity_log to authenticated;
revoke update, delete on public.activity_log from anon, authenticated;

-- $YSTEM: remove sales and everything tied to them for one venue (or every venue).
-- Backend > Master settings > Remove sales. Needs the $YSTEM password and the word DELETE every time.
create or replace function public.nipos_sales_summary(p_password text, p_venue text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r text; out jsonb;
begin
  r := public.nipos_check_system_password(p_password);
  if r <> 'ok' then return jsonb_build_object('error', r); end if;
  select jsonb_build_object(
    'sales',      (select jsonb_build_object('count', count(*), 'pence', coalesce(sum((data->>'total')::bigint), 0)) from sales where p_venue is null or venue_id = p_venue),
    'refunds',    (select jsonb_build_object('count', count(*), 'pence', coalesce(sum((data->>'pence')::bigint), 0)) from refunds where p_venue is null or venue_id = p_venue),
    'gratuities', (select jsonb_build_object('count', count(*), 'pence', coalesce(sum((data->>'amount')::bigint), 0)) from gratuities where p_venue is null or venue_id = p_venue),
    'abandoned',  (select jsonb_build_object('count', count(*), 'pence', coalesce(sum((data->>'total')::bigint), 0)) from abandoned where p_venue is null or venue_id = p_venue),
    'open_orders',(select jsonb_build_object('count', count(*)) from open_orders where p_venue is null or venue_id = p_venue),
    'z_reports',  (select jsonb_build_object('count', count(*)) from z_reports where p_venue is null or venue_id = p_venue)
  ) into out;
  return out;
end $$;
revoke all on function public.nipos_sales_summary(text, text) from public, anon;
grant execute on function public.nipos_sales_summary(text, text) to authenticated, service_role;

create or replace function public.nipos_wipe_sales(p_password text, p_venue text, p_confirm text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r text; n_sales int; n_ref int; n_grat int; n_ab int; n_open int; n_z int;
begin
  if coalesce(p_confirm, '') <> 'DELETE' then return jsonb_build_object('error', 'not_confirmed'); end if;
  r := public.nipos_check_system_password(p_password);
  if r <> 'ok' then return jsonb_build_object('error', r); end if;
  if p_venue is not null and not exists (select 1 from venues where id = p_venue) then return jsonb_build_object('error', 'no_venue'); end if;
  delete from sales       where p_venue is null or venue_id = p_venue; get diagnostics n_sales = row_count;
  delete from refunds     where p_venue is null or venue_id = p_venue; get diagnostics n_ref = row_count;
  delete from gratuities  where p_venue is null or venue_id = p_venue; get diagnostics n_grat = row_count;
  delete from abandoned   where p_venue is null or venue_id = p_venue; get diagnostics n_ab = row_count;
  delete from open_orders where p_venue is null or venue_id = p_venue; get diagnostics n_open = row_count;
  delete from z_reports   where p_venue is null or venue_id = p_venue; get diagnostics n_z = row_count;
  return jsonb_build_object('sales', n_sales, 'refunds', n_ref, 'gratuities', n_grat, 'abandoned', n_ab, 'open_orders', n_open, 'z_reports', n_z);
end $$;
revoke all on function public.nipos_wipe_sales(text, text, text) from public, anon;
grant execute on function public.nipos_wipe_sales(text, text, text) to authenticated, service_role;

-- Creates the hidden $YSTEM account, or changes its password if it already exists. Run it yourself in
-- the SQL Editor (see the bottom of this file). To sign in, type $YSTEM in Backend's PIN box and then
-- the password: the password is the account's real sign-in, so knowing the name gets nobody in. It
-- never appears in Backend's staff list, can't be edited or deleted from Backend, and can't sign in
-- to the till or order screen.
create or replace function public.nipos_setup_system_account(p_password text) returns text
language plpgsql volatile security definer set search_path = public, extensions, auth as $$
declare
  uid      uuid;
  existing text;
  em       constant text := 'system@nipos.local';
  pw_hash  text;
begin
  if p_password is null or length(p_password) < 10 then raise exception 'The password must be at least 10 characters'; end if;
  pw_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));
  select id into existing from public.staff_users where coalesce((data->>'system')::boolean, false) limit 1;
  if existing is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em, pw_hash, now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text,
            jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true), 'email', now(), now(), now());
    insert into public.staff_users (id, ts, data) values (uid::text, (extract(epoch from now()) * 1000)::bigint,
      jsonb_build_object('name', '$YSTEM', 'system', true, 'venueIds', '[]'::jsonb, 'groupIds', '[]'::jsonb, 'notifyVenueIds', '[]'::jsonb,
        'perms', jsonb_build_object('globalAdmin', true, 'active', true, 'backendAccess', true, 'xzRead', true,
                                    'placeOrders', false, 'productsOnStop', false, 'recoveryTool', false, 'callToService', false,
                                    'clearHistory', false, 'endOfDay', false, 'orderScreen', false, 'viewOpenOrders', false,
                                    'processRefunds', false)));
  else
    update auth.users set email = em, encrypted_password = pw_hash, updated_at = now() where id = existing::uuid;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', em), updated_at = now()
     where user_id = existing::uuid and provider = 'email';
  end if;
  insert into public.system_secrets (id, hash) values ('system_password', pw_hash)
  on conflict (id) do update set hash = excluded.hash, failed = 0, locked_until = null;
  return 'Done. In Backend, type $YSTEM in the PIN box, then your password.';
end $$;
revoke all on function public.nipos_setup_system_account(text) from public, anon, authenticated;

-- =====================================================================================================
-- TO CREATE $YSTEM (or change its password later), run this on its own in the SQL Editor with your
-- own password (10+ characters), then delete the query from the editor so it isn't left saved:
--
--   select public.nipos_setup_system_account('YOUR-PASSWORD');
-- =====================================================================================================
