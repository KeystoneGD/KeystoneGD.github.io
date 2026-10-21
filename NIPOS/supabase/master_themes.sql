-- =====================================================================================================
-- NIPOS: Master themes and the hidden $YSTEM account
--
-- Safe to re-run. Adds:
--   system_theme    the one master theme every device follows (anyone may read it; nobody may write it
--                   directly - only through nipos_set_master_theme below)
--   system_secrets  the $YSTEM password hash. RLS on with no policies, so the browser can never read it.
--   is_system_user(), nipos_check_system_password(), nipos_set_master_theme()   called from Backend
--   nipos_setup_system_account()   run by hand in the SQL Editor to create $YSTEM / change its PIN and
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

revoke all on function public.is_system_user() from public, anon;
revoke all on function public.nipos_check_system_password(text) from public, anon;
revoke all on function public.nipos_set_master_theme(text, text) from public, anon;
grant execute on function public.is_system_user() to authenticated, service_role;
grant execute on function public.nipos_check_system_password(text) to authenticated, service_role;
grant execute on function public.nipos_set_master_theme(text, text) to authenticated, service_role;

-- Creates the hidden $YSTEM account, or changes its PIN and password if it already exists.
-- Run it yourself in the SQL Editor (see the bottom of this file). It never appears in Backend's staff
-- list, can't be edited or deleted from Backend, and can't sign in to the till or order screen.
create or replace function public.nipos_setup_system_account(p_pin text, p_password text) returns text
language plpgsql volatile security definer set search_path = public, extensions, auth as $$
declare
  uid      uuid;
  existing text;
  em       text := 'pin' || p_pin || '@nipos.local';
begin
  if p_pin is null or p_pin !~ '^[0-9]{6,}$' then raise exception 'The PIN must be 6 or more digits'; end if;
  if p_password is null or length(p_password) < 10 then raise exception 'The password must be at least 10 characters'; end if;
  select id into existing from public.staff_users where coalesce((data->>'system')::boolean, false) limit 1;
  if exists (select 1 from auth.users where email = em and (existing is null or id::text <> existing)) then
    raise exception 'That PIN is already used by another account - pick a different one';
  end if;

  if existing is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
            extensions.crypt(p_pin, extensions.gen_salt('bf')), now(),
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
    update auth.users set email = em, encrypted_password = extensions.crypt(p_pin, extensions.gen_salt('bf')), updated_at = now()
     where id = existing::uuid;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', em), updated_at = now()
     where user_id = existing::uuid and provider = 'email';
  end if;

  insert into public.system_secrets (id, hash) values ('system_password', extensions.crypt(p_password, extensions.gen_salt('bf', 10)))
  on conflict (id) do update set hash = excluded.hash, failed = 0, locked_until = null;
  return 'Done. Sign in to Backend with the PIN, then enter the password.';
end $$;
revoke all on function public.nipos_setup_system_account(text, text) from public, anon, authenticated;

-- =====================================================================================================
-- TO CREATE $YSTEM (or change its PIN / password later), run this on its own in the SQL Editor with
-- your own PIN and password, then delete the query from the editor so the password isn't left saved:
--
--   select public.nipos_setup_system_account('YOUR-PIN', 'YOUR-PASSWORD');
-- =====================================================================================================
