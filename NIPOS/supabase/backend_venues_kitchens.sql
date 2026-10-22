-- =====================================================================================================
-- NIPOS: let Back Office users edit their own venues and kitchens (22 October 2026).
-- Run once in Supabase > SQL Editor. Adding or deleting a venue stays Global Admin only. Changes no data.
-- =====================================================================================================

-- True for an active person with Backend access who works at this venue (or a Global Admin).
create or replace function public.nipos_backend_venue(p_venue text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_global_admin() or exists (
    select 1 from public.staff_users s
    where s.id = auth.uid()::text
      and coalesce((s.data->'perms'->>'active')::boolean, true)
      and coalesce((s.data->'perms'->>'backendAccess')::boolean, false)
      and coalesce(s.data->'venueIds', '[]'::jsonb) ? p_venue);
$$;
revoke all on function public.nipos_backend_venue(text) from public, anon;
grant execute on function public.nipos_backend_venue(text) to authenticated;

-- True when every venue a kitchen cooks for is one this person can manage (and there's at least one).
create or replace function public.nipos_backend_kitchen(p_data jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_global_admin() or (
    jsonb_array_length(coalesce(p_data->'venueIds', '[]'::jsonb)) > 0
    and not exists (select 1 from jsonb_array_elements_text(coalesce(p_data->'venueIds', '[]'::jsonb)) v(id)
                    where not public.nipos_backend_venue(v.id)));
$$;
revoke all on function public.nipos_backend_kitchen(jsonb) from public, anon;
grant execute on function public.nipos_backend_kitchen(jsonb) to authenticated;

-- Venues: Back Office users edit the venues they work at.
drop policy if exists "backend users update their venues" on public.venues;
create policy "backend users update their venues" on public.venues for update to authenticated
  using (public.nipos_backend_venue(id)) with check (public.nipos_backend_venue(id));

-- Kitchens: Back Office users add, change and delete kitchens that cook only for their venues.
drop policy if exists "backend users manage their kitchens" on public.kitchens;
create policy "backend users manage their kitchens" on public.kitchens for all to authenticated
  using (public.nipos_backend_kitchen(data)) with check (public.nipos_backend_kitchen(data));

select 'done' as result;
