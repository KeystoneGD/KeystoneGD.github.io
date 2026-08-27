-- =====================================================================
-- WILLOW Event System — patron relay, Supabase schema
-- ---------------------------------------------------------------------
-- Paste into Supabase Dashboard > SQL Editor and Run.
-- Creates one table plus four atomic mutators. All array surgery happens
-- inside Postgres so simultaneous pushes from several phones cannot
-- overwrite each other (a read-then-write in JS would lose items).
-- =====================================================================

create table if not exists public.willow_rooms (
  room        text primary key,
  venue       jsonb       not null default '{}'::jsonb,
  feed        jsonb       not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

-- No public policies: every request goes through the Edge Function,
-- which uses the service role key. Browsers never touch this table.
alter table public.willow_rooms enable row level security;

-- ---------------------------------------------------------------------
-- GET — fetch, creating the room on first sight rather than 404ing
-- ---------------------------------------------------------------------
create or replace function public.willow_get(p_room text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  insert into willow_rooms (room) values (p_room)
  on conflict (room) do nothing;

  select jsonb_build_object('venue', venue, 'feed', feed)
    into result
    from willow_rooms where room = p_room;

  return coalesce(result, jsonb_build_object('venue', '{}'::jsonb, 'feed', '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- push — append one item, keeping only the newest p_max
-- ---------------------------------------------------------------------
create or replace function public.willow_push(p_room text, p_item jsonb, p_max int default 60)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into willow_rooms (room, feed)
  values (p_room, jsonb_build_array(p_item))
  on conflict (room) do update
    set feed = (
          select coalesce(jsonb_agg(x order by ord), '[]'::jsonb)
            from (
              select x, ord
                from jsonb_array_elements(willow_rooms.feed || jsonb_build_array(p_item))
                     with ordinality as t(x, ord)
               order by ord desc
               limit p_max
            ) kept
        ),
        updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- patch — shallow-merge into the item with a matching id
-- ---------------------------------------------------------------------
create or replace function public.willow_patch(p_room text, p_id text, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update willow_rooms
     set feed = (
           select coalesce(jsonb_agg(
                    case when x->>'id' = p_id then x || p_patch else x end
                    order by ord), '[]'::jsonb)
             from jsonb_array_elements(feed) with ordinality as t(x, ord)
         ),
         updated_at = now()
   where room = p_room;
end;
$$;

-- ---------------------------------------------------------------------
-- venue — replace the snapshot the patron site reads
-- ---------------------------------------------------------------------
create or replace function public.willow_venue(p_room text, p_venue jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into willow_rooms (room, venue) values (p_room, p_venue)
  on conflict (room) do update
    set venue = p_venue, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- clear — empty the feed, leave the venue snapshot alone
-- ---------------------------------------------------------------------
create or replace function public.willow_clear(p_room text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update willow_rooms
     set feed = '[]'::jsonb, updated_at = now()
   where room = p_room;
end;
$$;

-- ---------------------------------------------------------------------
-- Housekeeping: drop rooms untouched for a week.
-- Needs the pg_cron extension (Database > Extensions > enable pg_cron).
-- Safe to skip; delete rows by hand instead if you prefer.
-- ---------------------------------------------------------------------
-- select cron.schedule(
--   'willow-relay-cleanup', '17 4 * * *',
--   $$delete from public.willow_rooms where updated_at < now() - interval '7 days'$$
-- );
