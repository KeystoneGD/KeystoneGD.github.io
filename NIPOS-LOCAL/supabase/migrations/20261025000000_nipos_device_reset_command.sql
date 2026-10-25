-- Reset for service sends each till and order screen a "reset" command (clear what it holds on the
-- device, then reload). Databases set up before 25 October only allowed refresh and sign out.
alter table public.device_commands drop constraint if exists device_commands_action_check;
alter table public.device_commands add constraint device_commands_action_check check (action in ('refresh', 'signout', 'reset'));
