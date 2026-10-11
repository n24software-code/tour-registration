-- Team management, and the Realtime publication the admin pages subscribe to.

-- ---------------------------------------------------------------- team
-- Creating the login is the server's job (auth.admin.createUser); these two cover the
-- changes the PO makes to an existing member.
create or replace function public.set_admin_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.admins;
begin
  perform public.require_role(array['po']);
  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own role.' using errcode = 'P0001';
  end if;
  if p_role not in ('po', 'pm', 'registration', 'crowd') then
    raise exception 'Choose a role.' using errcode = 'P0001';
  end if;

  select * into target from public.admins where user_id = p_user_id;
  if not found then
    raise exception 'That team member no longer exists.' using errcode = 'P0002';
  end if;

  update public.admins set role = p_role where user_id = p_user_id;
  perform public.write_audit('team:role', null,
    target.email || ': ' || target.role || ' → ' || p_role);
end;
$$;
grant execute on function public.set_admin_role(uuid, text) to authenticated;

-- Removing the admins row removes access. The auth.users login is left alone so the
-- same person can be given a role again later without a new invitation.
create or replace function public.remove_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.admins;
begin
  perform public.require_role(array['po']);
  if p_user_id = auth.uid() then
    raise exception 'You can''t remove your own access.' using errcode = 'P0001';
  end if;

  select * into target from public.admins where user_id = p_user_id;
  if not found then return; end if;

  delete from public.admins where user_id = p_user_id;
  perform public.write_audit('team:remove', null, target.email);
end;
$$;
grant execute on function public.remove_admin(uuid) to authenticated;

-- ---------------------------------------------------------------- realtime
-- RLS still applies to Realtime, so each subscriber only receives the rows their own
-- policies would have let them select.
alter publication supabase_realtime add table public.tours;
alter publication supabase_realtime add table public.registrations;
alter publication supabase_realtime add table public.email_outbox;

-- Updates and deletes need the old row to be identifiable by the subscriber.
alter table public.tours         replica identity full;
alter table public.registrations replica identity full;
alter table public.email_outbox  replica identity full;
