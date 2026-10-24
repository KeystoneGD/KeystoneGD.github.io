-- Reset for service (Backend > Master settings > Reset for service). $YSTEM only, password checked.
-- Clears the chosen parts for one venue (p_venue) or every venue (p_venue null):
--   sales          sales, refunds, tips, abandoned orders, tabs, Z Reads and each venue's shift start
--   orders         open orders
--   logs           activity log, and (every venue only) the Discord queue (a record of posts already sent)
--   notifications  notifications, announcements, Suspend Orders / Service Break, and (every venue only)
--                  old device commands
--   screens        customer display screens, orders left half rung up, open items, who's online,
--                  and "Deals right now" back to automatic
--   stops          products on stop
--   hours          clocked shifts
--   stock          stock counts
-- Menus, prices, deals, discounts, staff, venues, kitchens, settings and push devices are never touched.
-- Run this whole file once in the Supabase SQL editor.

create or replace function public.nipos_reset_counts(p_venue text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sales',         (select jsonb_build_object('count', count(*), 'pence', coalesce(sum((data->>'total')::bigint), 0)) from sales where p_venue is null or venue_id = p_venue),
    'refunds',       (select jsonb_build_object('count', count(*), 'pence', coalesce(sum((data->>'pence')::bigint), 0)) from refunds where p_venue is null or venue_id = p_venue),
    'gratuities',    (select jsonb_build_object('count', count(*), 'pence', coalesce(sum((data->>'amount')::bigint), 0)) from gratuities where p_venue is null or venue_id = p_venue),
    'abandoned',     (select jsonb_build_object('count', count(*)) from abandoned where p_venue is null or venue_id = p_venue),
    'tabs',          (select jsonb_build_object('count', count(*)) from tabs where p_venue is null or venue_id = p_venue),
    'z_reports',     (select jsonb_build_object('count', count(*)) from z_reports where p_venue is null or venue_id = p_venue),
    'open_orders',   (select jsonb_build_object('count', count(*)) from open_orders where p_venue is null or venue_id = p_venue),
    'activity_log',  (select jsonb_build_object('count', count(*)) from activity_log where p_venue is null or venue_id = p_venue),
    'discord_queue', (select jsonb_build_object('count', case when p_venue is null then count(*) else 0 end) from discord_queue),
    'notifications', (select jsonb_build_object('count', count(*)) from notifications where p_venue is null or venue_id = p_venue),
    'device_commands', (select jsonb_build_object('count', case when p_venue is null then count(*) else 0 end) from device_commands),
    'displays',      (select jsonb_build_object('count', count(*)) from app_state where key like coalesce(replace(p_venue, '_', '\_'), '%') || ':display/%'),
    'presence',      (select jsonb_build_object('count', count(*)) from presence where p_venue is null or venue_id = p_venue),
    'stops',         (select jsonb_build_object('count', count(*)) from stops where p_venue is null or venue_id = p_venue),
    'clock_events',  (select jsonb_build_object('count', count(*)) from clock_events where p_venue is null or venue_id = p_venue),
    'stock_counts',  (select jsonb_build_object('count', count(*)) from stock_counts where p_venue is null or venue_id = p_venue)
  );
$$;
revoke all on function public.nipos_reset_counts(text) from public, anon, authenticated;

create or replace function public.nipos_reset_summary(p_password text, p_venue text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  r := public.nipos_check_system_password(p_password);
  if r <> 'ok' then return jsonb_build_object('error', r); end if;
  if p_venue is not null and not exists (select 1 from venues where id = p_venue) then return jsonb_build_object('error', 'no_venue'); end if;
  return public.nipos_reset_counts(p_venue);
end $$;
revoke all on function public.nipos_reset_summary(text, text) from public, anon;
grant execute on function public.nipos_reset_summary(text, text) to authenticated, service_role;

create or replace function public.nipos_reset_for_service(p_password text, p_venue text, p_parts text[], p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r text; v_before jsonb; s jsonb; p text := coalesce(replace(p_venue, '_', '\_'), '%'); -- LIKE pattern for this venue's keys
begin
  if coalesce(p_confirm, '') <> 'RESET' then return jsonb_build_object('error', 'not_confirmed'); end if;
  r := public.nipos_check_system_password(p_password);
  if r <> 'ok' then return jsonb_build_object('error', r); end if;
  if p_venue is not null and not exists (select 1 from venues where id = p_venue) then return jsonb_build_object('error', 'no_venue'); end if;
  if p_parts is null or cardinality(p_parts) = 0 then return jsonb_build_object('error', 'nothing_picked'); end if;
  v_before := public.nipos_reset_counts(p_venue);

  if 'sales' = any(p_parts) then
    delete from sales      where p_venue is null or venue_id = p_venue;
    delete from refunds    where p_venue is null or venue_id = p_venue;
    delete from gratuities where p_venue is null or venue_id = p_venue;
    delete from abandoned  where p_venue is null or venue_id = p_venue;
    delete from tabs       where p_venue is null or venue_id = p_venue;
    delete from z_reports  where p_venue is null or venue_id = p_venue;
    delete from app_state  where key like p || ':shiftStart';
  end if;
  if 'orders' = any(p_parts) then
    delete from open_orders where p_venue is null or venue_id = p_venue;
  end if;
  if 'logs' = any(p_parts) then
    delete from activity_log where p_venue is null or venue_id = p_venue;
    if p_venue is null then delete from discord_queue where true; end if; -- the API refuses a DELETE with no WHERE
  end if;
  if 'notifications' = any(p_parts) then
    delete from notifications where p_venue is null or venue_id = p_venue;
    if p_venue is null then delete from device_commands where ts < (extract(epoch from now()) * 1000)::bigint; end if;
    -- Announcements (banners and pop-ups).
    if p_venue is null then
      update system_theme set settings = settings - 'announcementPosts' - 'announcementPopups' where id = 'current';
    else
      update system_theme set settings = settings #- array['announcementPosts', p_venue] #- array['announcementPopups', p_venue] where id = 'current';
    end if;
    -- Suspend Orders and Service Break lifted.
    select data into s from app_settings where id = 'global' for update;
    if s is not null then
      if p_venue is null then
        s := s || jsonb_build_object('ordersSuspended', false, 'serviceBreak', false, 'suspendedVenueIds', '[]'::jsonb, 'breakVenueIds', '[]'::jsonb);
      else
        s := s || jsonb_build_object(
          'suspendedVenueIds', (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(s->'suspendedVenueIds', '[]'::jsonb)) x where x <> p_venue),
          'breakVenueIds',     (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(s->'breakVenueIds', '[]'::jsonb)) x where x <> p_venue));
      end if;
      update app_settings set data = s, ts = (extract(epoch from now()) * 1000)::bigint where id = 'global';
    end if;
  end if;
  if 'screens' = any(p_parts) then
    delete from app_state where key like p || ':display/%';
    delete from app_state where key like p || ':state/starlightTill.cart.v1' or key like p || ':state/starlightTill.mode.v1';
    update app_state set value = '[]'::jsonb where key like p || ':state/starlightTill.customProducts.v1';
    update app_state set value = 'null'::jsonb where key like p || ':state/starlightTill.hhOverride.v1';
    delete from presence where p_venue is null or venue_id = p_venue;
  end if;
  if 'stops' = any(p_parts) then
    delete from stops where p_venue is null or venue_id = p_venue;
  end if;
  if 'hours' = any(p_parts) then
    delete from clock_events where p_venue is null or venue_id = p_venue;
  end if;
  if 'stock' = any(p_parts) then
    delete from stock_counts where p_venue is null or venue_id = p_venue;
  end if;
  return jsonb_build_object('ok', true, 'before', v_before);
end $$;
revoke all on function public.nipos_reset_for_service(text, text, text[], text) from public, anon;
grant execute on function public.nipos_reset_for_service(text, text, text[], text) to authenticated, service_role;
