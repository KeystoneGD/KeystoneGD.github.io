-- =====================================================================================================
-- NIPOS: full Supabase database setup
--
-- Recreates everything the NIPOS pages (index.html, orders.html, backend.html via db.js) expect:
-- tables, indexes, RLS helper functions, row-level security policies, the merge_open_order RPC,
-- the notification-sounds Storage bucket and its policies, and the global app_settings row.
--
-- How to use on a brand-new Supabase project:
--   1. Dashboard > SQL Editor > New query, paste this whole file, Run.
--      It's safe to re-run: everything uses IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.
--   2. Follow the "AFTER RUNNING" steps at the bottom (first admin account, first venue, secrets,
--      Edge Functions, and pointing db.js at the new project).
--
-- Mirrors the live schema as of 2026-09-25.
-- =====================================================================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";


-- -----------------------------------------------------------------------------------------------------
-- Global (not venue-scoped) tables
-- -----------------------------------------------------------------------------------------------------

-- One row per venue. data = { name, active, discordWebhooks: { stop, order, zread } }
create table if not exists public.venues (
  id   text   primary key,
  ts   bigint not null,
  data jsonb  not null
);
create index if not exists venues_ts_idx on public.venues (ts desc);

-- One row per staff member; id = the auth.users id (as text).
-- data = { name, pin, perms: {globalAdmin, active, placeOrders, ...}, venueIds: [], groupIds: [],
--          notifyVenueIds: [], notificationSound }
create table if not exists public.staff_users (
  id   text   primary key,
  ts   bigint not null,
  data jsonb  not null
);
create index if not exists staff_users_ts_idx on public.staff_users (ts desc);

-- Staff groups (Bar Staff, Table Service, ...). data = { name }
create table if not exists public.staff_groups (
  id   text   primary key,
  ts   bigint not null,
  data jsonb  not null
);
create index if not exists staff_groups_ts_idx on public.staff_groups (ts desc);

-- Single row id = 'global'. data = { serviceBreak, maintenanceMode, ordersSuspended, sessionTimeoutMinutes }
create table if not exists public.app_settings (
  id   text   primary key,
  ts   bigint not null,
  data jsonb  not null
);

-- Server-only secrets (VAPID keys for web push). RLS is on with NO policies, so only the
-- service role (Edge Functions) can read it - never the browser.
create table if not exists public.app_secrets (
  key   text primary key,
  value text not null
);

-- Per-venue key/value state. key = '<venueId>:<path>' (e.g. 'venue_123:shiftStart').
create table if not exists public.app_state (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);


-- -----------------------------------------------------------------------------------------------------
-- Venue-scoped event/row tables (all share the rowStore shape: id, ts, venue_id, data)
-- -----------------------------------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'sales', 'abandoned', 'gratuities', 'refunds', 'open_orders', 'stops',
    'mixer_overrides', 'custom_discounts', 'categories', 'catalogue_items'
  ] loop
    execute format($f$
      create table if not exists public.%1$I (
        id       text   primary key,
        ts       bigint not null,
        data     jsonb  not null,
        venue_id text   not null,
        constraint %1$s_venue_fk foreign key (venue_id) references public.venues (id)
      )$f$, t);
    execute format('create index if not exists %1$s_ts_idx on public.%1$I (ts desc)', t);
    execute format('create index if not exists %1$s_venue_ts_idx on public.%1$I (venue_id, ts desc)', t);
  end loop;
end $$;

-- Personal notifications. Addressed to a user (or 'all'), not a venue - RLS uses to/from user ids.
create table if not exists public.notifications (
  id           text   primary key,
  ts           bigint not null,
  data         jsonb  not null,
  venue_id     text   not null,
  to_user_id   text   generated always as (data ->> 'toUserId') stored,
  from_user_id text   generated always as (data ->> 'fromUserId') stored,
  constraint notifications_venue_fk foreign key (venue_id) references public.venues (id)
);
create index if not exists notifications_ts_idx       on public.notifications (ts desc);
create index if not exists notifications_venue_ts_idx on public.notifications (venue_id, ts desc);
create index if not exists notifications_to_user_id_idx on public.notifications (to_user_id);

-- Online heartbeat, one row per signed-in staff member (id = user id).
create table if not exists public.presence (
  id       text   primary key,
  ts       bigint not null,
  venue_id text   not null references public.venues (id),
  data     jsonb  not null
);
create index if not exists presence_venue_ts_idx on public.presence (venue_id, ts desc);

-- Web push subscriptions.
create table if not exists public.push_subscriptions (
  id           text        primary key,
  user_id      text        not null,
  endpoint     text        not null,
  subscription jsonb       not null,
  created_at   timestamptz default now(),
  venue_id     text        not null,
  constraint push_subscriptions_venue_fk foreign key (venue_id) references public.venues (id)
);
create index if not exists push_subscriptions_user_idx  on public.push_subscriptions (user_id);
create index if not exists push_subscriptions_venue_idx on public.push_subscriptions (venue_id);

-- Archived Z Reads (one per closed shift).
create table if not exists public.z_reports (
  id           text   primary key,
  closed_at    bigint not null,
  summary      jsonb  not null,
  html         text,
  venue_id     text   not null,
  transactions jsonb,
  constraint z_reports_venue_fk foreign key (venue_id) references public.venues (id)
);
create index if not exists z_reports_closed_at_idx on public.z_reports (closed_at desc);
create index if not exists z_reports_venue_idx     on public.z_reports (venue_id, closed_at desc);


-- -----------------------------------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER so they can read staff_users without recursing into its RLS)
-- -----------------------------------------------------------------------------------------------------

create or replace function public.is_global_admin()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce((data->'perms'->>'globalAdmin')::boolean, false)
  from public.staff_users
  where id = auth.uid()::text
$$;

create or replace function public.is_member_of_venue(vid text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(
    (select (data->'venueIds') ? vid
     from public.staff_users
     where id = auth.uid()::text),
    false
  )
$$;

create or replace function public.has_xzread()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce((data->'perms'->>'xzRead')::boolean, false)
  from public.staff_users
  where id = auth.uid()::text
$$;

-- Only signed-in users (and the service role) may call the helpers.
revoke execute on function public.is_global_admin()        from public, anon;
revoke execute on function public.is_member_of_venue(text) from public, anon;
revoke execute on function public.has_xzread()             from public, anon;
grant  execute on function public.is_global_admin()        to authenticated, service_role;
grant  execute on function public.is_member_of_venue(text) to authenticated, service_role;
grant  execute on function public.has_xzread()             to authenticated, service_role;

-- Atomic jsonb merge into an open order (used by mergeOpenOrder() in db.js). SECURITY INVOKER, so the
-- caller's RLS on open_orders still applies.
create or replace function public.merge_open_order(p_id text, p_patch jsonb)
returns jsonb
language sql
set search_path to 'public'
as $$
  update open_orders set data = data || p_patch, ts = extract(epoch from now())::bigint * 1000
  where id = p_id
  returning data;
$$;


-- -----------------------------------------------------------------------------------------------------
-- Table privileges. Older Supabase projects grant these automatically; newer ones may not expose new
-- tables to the Data API by default, so grant explicitly to match the live project. RLS below is what
-- actually restricts access.
-- -----------------------------------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant execute on function public.merge_open_order(text, jsonb) to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------------------------------

alter table public.venues             enable row level security;
alter table public.staff_users        enable row level security;
alter table public.staff_groups       enable row level security;
alter table public.app_settings       enable row level security;
alter table public.app_secrets        enable row level security;  -- intentionally no policies
alter table public.app_state          enable row level security;
alter table public.notifications      enable row level security;
alter table public.presence           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.z_reports          enable row level security;

-- Venue-scoped tables: any member of the venue (or a global admin) has full access.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sales', 'abandoned', 'gratuities', 'refunds', 'open_orders', 'stops',
    'mixer_overrides', 'custom_discounts', 'categories', 'catalogue_items', 'push_subscriptions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "venue members full access" on public.%I', t);
    execute format($p$
      create policy "venue members full access" on public.%I
        for all to authenticated
        using (is_global_admin() or is_member_of_venue(venue_id))
        with check (is_global_admin() or is_member_of_venue(venue_id))$p$, t);
  end loop;
end $$;

-- venues: everyone signed in can read (cross-venue notify picker); only global admins write.
drop policy if exists "read all venues"            on public.venues;
drop policy if exists "global admin inserts venues" on public.venues;
drop policy if exists "global admin updates venues" on public.venues;
create policy "read all venues"             on public.venues for select to authenticated using (true);
create policy "global admin inserts venues" on public.venues for insert to authenticated with check (is_global_admin());
create policy "global admin updates venues" on public.venues for update to authenticated using (is_global_admin()) with check (is_global_admin());
-- (Venue deletes go through the manage-staff Edge Function with the service role.)

-- staff_users: see yourself, anyone sharing a venue with you, or everyone if global admin.
-- Creating/deleting staff and changing PINs goes through the manage-staff Edge Function.
drop policy if exists "read own or shared venue"     on public.staff_users;
drop policy if exists "update shared venue or admin" on public.staff_users;
create policy "read own or shared venue" on public.staff_users for select to authenticated
  using (
    is_global_admin()
    or id = auth.uid()::text
    or exists (
      select 1 from jsonb_array_elements_text(coalesce(staff_users.data -> 'venueIds', '[]'::jsonb)) vid(value)
      where is_member_of_venue(vid.value)
    )
  );
create policy "update shared venue or admin" on public.staff_users for update to authenticated
  using (
    is_global_admin()
    or exists (
      select 1 from jsonb_array_elements_text(coalesce(staff_users.data -> 'venueIds', '[]'::jsonb)) vid(value)
      where is_member_of_venue(vid.value)
    )
  )
  with check (
    is_global_admin()
    or exists (
      select 1 from jsonb_array_elements_text(coalesce(staff_users.data -> 'venueIds', '[]'::jsonb)) vid(value)
      where is_member_of_venue(vid.value)
    )
  );

-- staff_groups: everyone reads, global admins write.
drop policy if exists "read groups"                 on public.staff_groups;
drop policy if exists "global admin writes groups"  on public.staff_groups;
drop policy if exists "global admin updates groups" on public.staff_groups;
drop policy if exists "global admin deletes groups" on public.staff_groups;
create policy "read groups"                 on public.staff_groups for select to authenticated using (true);
create policy "global admin writes groups"  on public.staff_groups for insert to authenticated with check (is_global_admin());
create policy "global admin updates groups" on public.staff_groups for update to authenticated using (is_global_admin()) with check (is_global_admin());
create policy "global admin deletes groups" on public.staff_groups for delete to authenticated using (is_global_admin());

-- app_settings: everyone reads, global admins write.
drop policy if exists "authenticated read settings"  on public.app_settings;
drop policy if exists "global admin inserts settings" on public.app_settings;
drop policy if exists "global admin writes settings"  on public.app_settings;
create policy "authenticated read settings"   on public.app_settings for select to authenticated using (true);
create policy "global admin inserts settings" on public.app_settings for insert to authenticated with check (is_global_admin());
create policy "global admin writes settings"  on public.app_settings for update to authenticated using (is_global_admin()) with check (is_global_admin());

-- app_state: venue is the part of the key before the first ':'.
drop policy if exists "venue members access app_state" on public.app_state;
create policy "venue members access app_state" on public.app_state for all to authenticated
  using (is_global_admin() or is_member_of_venue(split_part(key, ':', 1)))
  with check (is_global_admin() or is_member_of_venue(split_part(key, ':', 1)));

-- notifications: recipient (or 'all'), sender, or global admin; you can only send as yourself.
drop policy if exists "recipient sender or admin access" on public.notifications;
create policy "recipient sender or admin access" on public.notifications for all
  using (
    is_global_admin()
    or to_user_id = auth.uid()::text
    or to_user_id = 'all'
    or from_user_id = auth.uid()::text
  )
  with check (is_global_admin() or from_user_id = auth.uid()::text);

-- presence: everyone reads (cross-venue "who's online"); write only within your own venues.
drop policy if exists "read all presence"         on public.presence;
drop policy if exists "write own venue presence"  on public.presence;
drop policy if exists "update own venue presence" on public.presence;
drop policy if exists "delete own venue presence" on public.presence;
create policy "read all presence"         on public.presence for select to authenticated using (true);
create policy "write own venue presence"  on public.presence for insert to authenticated with check (is_global_admin() or is_member_of_venue(venue_id));
create policy "update own venue presence" on public.presence for update to authenticated using (is_global_admin() or is_member_of_venue(venue_id)) with check (is_global_admin() or is_member_of_venue(venue_id));
create policy "delete own venue presence" on public.presence for delete to authenticated using (is_global_admin() or is_member_of_venue(venue_id));

-- z_reports: members archive their venue's shift; only staff with X/Z Read (or global admins) can view
-- past ones; only global admins delete.
drop policy if exists "venue members can archive a shift"          on public.z_reports;
drop policy if exists "venue members can upsert their own archive" on public.z_reports;
drop policy if exists "xzread perm can view past z reads"          on public.z_reports;
drop policy if exists "global admin can delete z reads"            on public.z_reports;
create policy "venue members can archive a shift" on public.z_reports for insert
  with check (is_global_admin() or is_member_of_venue(venue_id));
create policy "venue members can upsert their own archive" on public.z_reports for update
  using (is_global_admin() or is_member_of_venue(venue_id))
  with check (is_global_admin() or is_member_of_venue(venue_id));
create policy "xzread perm can view past z reads" on public.z_reports for select
  using (is_global_admin() or (is_member_of_venue(venue_id) and has_xzread()));
create policy "global admin can delete z reads" on public.z_reports for delete
  using (is_global_admin());


-- -----------------------------------------------------------------------------------------------------
-- Storage: notification sounds (Backend > Settings > Notification Sounds)
-- -----------------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'notification-sounds', 'notification-sounds', true, 2097152,
  array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-m4a', 'audio/mp4']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "read notification sounds"                on storage.objects;
drop policy if exists "global admin uploads notification sounds" on storage.objects;
drop policy if exists "global admin deletes notification sounds" on storage.objects;
create policy "read notification sounds" on storage.objects for select to anon, authenticated
  using (bucket_id = 'notification-sounds');
create policy "global admin uploads notification sounds" on storage.objects for insert to authenticated
  with check (bucket_id = 'notification-sounds' and public.is_global_admin());
create policy "global admin deletes notification sounds" on storage.objects for delete to authenticated
  using (bucket_id = 'notification-sounds' and public.is_global_admin());


-- -----------------------------------------------------------------------------------------------------
-- Seed data
-- -----------------------------------------------------------------------------------------------------

insert into public.app_settings (id, ts, data)
values (
  'global',
  (extract(epoch from now()) * 1000)::bigint,
  '{"serviceBreak": false, "maintenanceMode": false, "ordersSuspended": false, "sessionTimeoutMinutes": null}'::jsonb
)
on conflict (id) do nothing;


-- =====================================================================================================
-- AFTER RUNNING
-- =====================================================================================================
--
-- 1) Create the first Global Admin.
--    Staff sign in with a PIN (6+ digits), which maps to an auth user with
--    email = 'pin<PIN>@nipos.local' and password = '<PIN>'.
--
--    a. Dashboard > Authentication > Users > Add user > Create new user:
--         Email:    pin123456@nipos.local      (swap 123456 for your PIN)
--         Password: 123456
--         Tick "Auto Confirm User".
--    b. Then run (with the same PIN / your name):
--
--    insert into public.staff_users (id, ts, data)
--    select u.id::text, (extract(epoch from now()) * 1000)::bigint,
--           jsonb_build_object(
--             'name', 'Administrator',
--             'pin', '123456',
--             'perms', jsonb_build_object(
--               'globalAdmin', true, 'active', true, 'placeOrders', true, 'productsOnStop', true,
--               'recoveryTool', true, 'callToService', true, 'clearHistory', true, 'xzRead', true,
--               'endOfDay', true, 'backendAccess', true, 'orderScreen', true, 'viewOpenOrders', true,
--               'processRefunds', true
--             ),
--             'venueIds', '[]'::jsonb, 'groupIds', '[]'::jsonb, 'notifyVenueIds', '[]'::jsonb
--           )
--    from auth.users u
--    where u.email = 'pin123456@nipos.local'
--    on conflict (id) do nothing;
--
--    Everything else (venues, staff, groups, catalogue) can then be set up from backend.html.
--
-- 2) (Optional) Create a first venue here instead of in Backend:
--
--    insert into public.venues (id, ts, data)
--    values ('venue_' || (extract(epoch from now()) * 1000)::bigint,
--            (extract(epoch from now()) * 1000)::bigint,
--            '{"name": "My Venue", "active": true, "discordWebhooks": {"stop": null, "order": null, "zread": null}}');
--
-- 3) Web push secrets (used by the send-push Edge Function). Generate a fresh VAPID key pair
--    (e.g. `npx web-push generate-vapid-keys`) - don't reuse the old project's keys:
--
--    insert into public.app_secrets (key, value) values
--      ('vapid_public_key',  '<public key>'),
--      ('vapid_private_key', '<private key>'),
--      ('vapid_subject',     'mailto:you@example.com')
--    on conflict (key) do update set value = excluded.value;
--
-- 4) Edge Functions aren't part of SQL - redeploy them to the new project:
--      manage-staff  (verify JWT: ON)  - create/delete staff, change PINs, notify subscriptions, delete venue
--      send-push     (verify JWT: OFF) - web push delivery
--
-- 5) Point the site at the new project: update SUPABASE_URL and SUPABASE_ANON_KEY at the top of
--    NIPOS/db.js (Dashboard > Project Settings > API).
-- =====================================================================================================
