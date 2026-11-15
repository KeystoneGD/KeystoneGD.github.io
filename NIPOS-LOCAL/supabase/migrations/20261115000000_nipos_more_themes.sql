-- Ten more master themes (15 November). Adds their names to the themes the database accepts; no data changes.
create or replace function public.nipos_set_master_theme(p_password text, p_theme text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare r text;
begin
  r := public.nipos_check_system_password(p_password);
  if r <> 'ok' then return r; end if;
  if p_theme not in ('classic', 'neon-nights', 'classic-pub', 'modern-loft', 'electric-night', 'lounge-sunset', 'coastal-breeze',
                     'speakeasy', 'copper-oak', 'gin-garden', 'midnight-velvet', 'tiki-bar', 'craft-brewery', 'rose-terrace',
                     'arcade', 'nordic-frost', 'sunlight') then
    return 'bad_theme';
  end if;
  insert into public.system_theme (id, theme, ts, set_by)
  values ('current', p_theme, (extract(epoch from now()) * 1000)::bigint, auth.uid()::text)
  on conflict (id) do update set theme = excluded.theme, ts = excluded.ts, set_by = excluded.set_by;
  return 'ok';
end $$;
revoke all on function public.nipos_set_master_theme(text, text) from public, anon;
grant execute on function public.nipos_set_master_theme(text, text) to authenticated, service_role;
