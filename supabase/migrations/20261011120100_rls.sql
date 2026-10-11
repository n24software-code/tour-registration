-- Row level security for every table.
--
-- The rule throughout: visitors never touch the database directly, admins read what
-- their role allows, and every write goes through a security-definer RPC that checks
-- the role itself. A table with RLS on and no policy for a command denies it outright,
-- which is how insert/update/delete are blocked on registrations and audit_logs.

-- ---------------------------------------------------------------- the caller's role
-- SECURITY DEFINER so it can read `admins` without going through that table's own
-- policy — otherwise a policy that calls this function would recurse for ever.
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.admins where user_id = auth.uid();
$$;

comment on function public.current_role() is
  'The signed-in user''s admin role, or null. Always call it schema-qualified: '
  'CURRENT_ROLE is also a reserved SQL keyword.';

revoke all on function public.current_role() from public;
grant execute on function public.current_role() to anon, authenticated;

-- ---------------------------------------------------------------- tours
alter table public.tours enable row level security;

-- The public registration form has to read these before anyone signs in.
create policy tours_select_all
  on public.tours for select
  using (true);

create policy tours_write_po_pm
  on public.tours for all
  to authenticated
  using (public.current_role() in ('po', 'pm'))
  with check (public.current_role() in ('po', 'pm'));

-- ---------------------------------------------------------------- registrations
alter table public.registrations enable row level security;

-- Any admin may read them; nobody may write directly. Changes go through the RPCs.
create policy registrations_select_admins
  on public.registrations for select
  to authenticated
  using (public.current_role() is not null);

-- ---------------------------------------------------------------- admins
alter table public.admins enable row level security;

-- An admin sees the whole team; someone with no role yet can still read their own
-- (absent) row, which is what lets the app say "no team role yet" instead of hanging.
create policy admins_select
  on public.admins for select
  to authenticated
  using (user_id = auth.uid() or public.current_role() is not null);

create policy admins_write_po
  on public.admins for all
  to authenticated
  using (public.current_role() = 'po')
  with check (public.current_role() = 'po');

-- ---------------------------------------------------------------- audit_logs
alter table public.audit_logs enable row level security;

-- Read for the two management roles; no insert, update or delete policy exists, so
-- the trail can only ever be appended to by the security-definer RPCs.
create policy audit_logs_select_po_pm
  on public.audit_logs for select
  to authenticated
  using (public.current_role() in ('po', 'pm'));

-- ---------------------------------------------------------------- email_outbox
alter table public.email_outbox enable row level security;

-- Admins read it so the Registrations page can show Sent / Pending / Error.
-- Anonymous visitors get nothing: the bodies contain personal details.
create policy email_outbox_select_admins
  on public.email_outbox for select
  to authenticated
  using (public.current_role() is not null);

-- ---------------------------------------------------------------- table grants
-- RLS filters rows, but the role still needs the table privilege to get that far.
grant select on public.tours to anon, authenticated;
grant select on public.registrations, public.admins, public.audit_logs, public.email_outbox
  to authenticated;
grant insert, update, delete on public.tours to authenticated;  -- narrowed by RLS to po/pm
grant insert, update, delete on public.admins to authenticated; -- narrowed by RLS to po
