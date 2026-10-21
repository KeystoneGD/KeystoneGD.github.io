-- =====================================================================================================
-- NIPOS: let regular Backend users pause orders at their own venues (22 October 2026).
-- Run once in Supabase > SQL Editor. Backend > Notifications uses it for Suspend Orders and Service Break;
-- Global Admins keep changing every venue directly, as before. Changes no data.
-- =====================================================================================================

-- Turns Suspend Orders ('suspend') or Service Break ('break') on or off for one venue. Only for someone
-- active with Backend access who works at that venue, or a Global Admin. The old every-venue switch, if
-- it's on, is turned into the full list first so the other venues keep their state.
create or replace function public.nipos_set_lockdown(p_kind text, p_venue text, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare me text := auth.uid()::text; s jsonb; flag text; list text; ids jsonb;
begin
  if me is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if p_kind = 'suspend' then flag := 'ordersSuspended'; list := 'suspendedVenueIds';
  elsif p_kind = 'break' then flag := 'serviceBreak'; list := 'breakVenueIds';
  else return jsonb_build_object('error', 'bad_kind'); end if;
  select data into s from public.staff_users where id = me;
  if not (public.is_global_admin() or (
      s is not null and coalesce((s->'perms'->>'active')::boolean, true)
      and coalesce((s->'perms'->>'backendAccess')::boolean, false)
      and coalesce(s->'venueIds', '[]'::jsonb) ? p_venue)) then
    return jsonb_build_object('error', 'not_allowed');
  end if;
  select data into s from public.app_settings where id = 'global' for update;
  s := coalesce(s, '{}'::jsonb);
  if coalesce((s->>flag)::boolean, false) then ids := (select coalesce(jsonb_agg(v.id), '[]'::jsonb) from public.venues v);
  else ids := coalesce(s->list, '[]'::jsonb); end if;
  ids := (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(ids) x where x <> p_venue);
  if p_on then ids := ids || to_jsonb(p_venue); end if;
  update public.app_settings set ts = (extract(epoch from now()) * 1000)::bigint,
    data = s || jsonb_build_object(flag, false, list, ids) where id = 'global';
  return jsonb_build_object('ok', true, 'venues', ids);
end $$;
revoke all on function public.nipos_set_lockdown(text, text, boolean) from public, anon;
grant execute on function public.nipos_set_lockdown(text, text, boolean) to authenticated;

select 'done' as result;
