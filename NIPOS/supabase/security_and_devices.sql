-- =====================================================================================================
-- NIPOS: security fix, device controls and the Discord queue (22 October 2026).
-- Run once in Supabase > SQL Editor, after the site is on version 20261022x or later.
-- Nothing here deletes data except the readable PIN copies in step 5 (the sign-in system keeps the real ones).
-- =====================================================================================================

-- 1. Manager approval checks the PIN in the database, so staff never need to read anyone's PIN.
--    10 wrong tries in 5 minutes from one account locks it out for the rest of those 5 minutes.
create table if not exists public.pin_attempts (id bigserial primary key, uid text not null, ts timestamptz not null default now());
alter table public.pin_attempts enable row level security;
create or replace function public.nipos_check_approval_pin(p_pin text, p_venue text) returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare me text := auth.uid()::text; uid text; s jsonb;
begin
  if me is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if (select count(*) from public.pin_attempts where pin_attempts.uid = me and ts > now() - interval '5 minutes') >= 10 then
    return jsonb_build_object('error', 'locked');
  end if;
  select au.id::text into uid from auth.users au where au.email = 'pin' || btrim(coalesce(p_pin, '')) || '@nipos.local' limit 1;
  if uid is not null then select data into s from public.staff_users where id = uid; end if;
  if s is null or coalesce((s->'perms'->>'active')::boolean, true) = false or coalesce((s->>'system')::boolean, false)
     or not (coalesce((s->'perms'->>'approveRequests')::boolean, false) or coalesce((s->'perms'->>'globalAdmin')::boolean, false))
     or not (coalesce((s->'perms'->>'globalAdmin')::boolean, false) or coalesce(s->'venueIds', '[]'::jsonb) ? p_venue) then
    insert into public.pin_attempts (uid) values (me);
    delete from public.pin_attempts where ts < now() - interval '1 day';
    return jsonb_build_object('error', 'no');
  end if;
  return jsonb_build_object('id', uid, 'name', s->>'name');
end $$;
revoke all on function public.nipos_check_approval_pin(text, text) from public, anon;
grant execute on function public.nipos_check_approval_pin(text, text) to authenticated;

-- 2. $YSTEM and Global Admins can remove devices from Device health.
drop policy if exists "admins remove devices" on public.devices;
create policy "admins remove devices" on public.devices for delete to authenticated using (public.is_global_admin() or public.is_system_user());
grant delete on public.devices to authenticated;

-- 3. Backend can refresh or sign out one device, or sign one person out everywhere.
create table if not exists public.device_commands (
  id text primary key, ts bigint not null,
  target_type text not null check (target_type in ('device', 'user')), target_id text not null,
  action text not null check (action in ('refresh', 'signout')), data jsonb not null default '{}'::jsonb
);
create index if not exists device_commands_target on public.device_commands (target_type, target_id, ts);
alter table public.device_commands enable row level security;
drop policy if exists "read device commands" on public.device_commands;
create policy "read device commands" on public.device_commands for select to authenticated using (true);
drop policy if exists "managers send device commands" on public.device_commands;
create policy "managers send device commands" on public.device_commands for insert to authenticated with check (
  public.is_global_admin() or public.is_system_user()
  or exists (select 1 from public.staff_users su where su.id = auth.uid()::text and coalesce((su.data->'perms'->>'backendAccess')::boolean, false)));
grant select, insert on public.device_commands to authenticated;

-- 4. Discord queue: the tills queue their posts; the discord-relay function sends them in order,
--    batched and paced, with retries. Tills can add posts but can't read the queue (it holds webhook links).
create table if not exists public.discord_queue (
  id text primary key, ts bigint not null, webhook text not null, embed jsonb not null,
  tries int not null default 0, claimed_at timestamptz, sent_at timestamptz, last_error text
);
create index if not exists discord_queue_unsent on public.discord_queue (ts) where sent_at is null;
alter table public.discord_queue enable row level security;
drop policy if exists "tills queue discord posts" on public.discord_queue;
create policy "tills queue discord posts" on public.discord_queue for insert to authenticated with check (true);
grant insert on public.discord_queue to authenticated;
create or replace function public.discord_claim(p_limit int) returns setof public.discord_queue
language sql volatile security definer set search_path = public as $$
  update public.discord_queue set claimed_at = now(), tries = tries + 1
  where id in (select id from public.discord_queue
               where sent_at is null and tries < 10 and (claimed_at is null or claimed_at < now() - interval '2 minutes')
               order by ts limit p_limit for update skip locked)
  returning *;
$$;
create or replace function public.discord_failed(p_ids text[], p_error text) returns void
language sql volatile security definer set search_path = public as $$
  update public.discord_queue set claimed_at = null, last_error = p_error where id = any(p_ids);
$$;
revoke all on function public.discord_claim(int) from public, anon, authenticated;
revoke all on function public.discord_failed(text[], text) from public, anon, authenticated;
-- Every minute, send anything still waiting (the tills also nudge it straight away).
select cron.unschedule('nipos-discord-relay') where exists (select 1 from cron.job where jobname = 'nipos-discord-relay');
select cron.schedule('nipos-discord-relay', '* * * * *', $cron$ select net.http_post(
  url := 'https://djegigghjeisoyecxeyo.supabase.co/functions/v1/discord-relay',
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.app_secrets where key = 'cron_secret')),
  body := '{}'::jsonb); $cron$);

-- 5. Remove the readable PIN copies. (Everyone should then change their PIN: the old ones could be read.)
update public.staff_users set data = data - 'pin' where data ? 'pin';

select 'done' as result;
