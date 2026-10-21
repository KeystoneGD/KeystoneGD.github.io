-- NIPOS: Kitchens (Backend > Kitchens). Each kitchen cooks for one or more venues; /kitchen shows
-- their food orders together. Everyone signed in can read them; only a Global Admin can change them.
create table if not exists public.kitchens (
  id text primary key,
  ts bigint not null default 0,
  data jsonb not null default '{}'::jsonb
);
alter table public.kitchens enable row level security;
drop policy if exists "read kitchens" on public.kitchens;
create policy "read kitchens" on public.kitchens for select to authenticated using (true);
drop policy if exists "global admin manages kitchens" on public.kitchens;
create policy "global admin manages kitchens" on public.kitchens for all to authenticated
  using (public.is_global_admin()) with check (public.is_global_admin());
grant select, insert, update, delete on public.kitchens to authenticated;
