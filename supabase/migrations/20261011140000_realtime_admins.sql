-- The Team page and the AuthProvider both watch `admins`: one so a new member appears
-- without a reload, the other so a role change or removal takes effect immediately.
-- Neither worked, because the table was never in the publication.
--
-- RLS still applies, so only signed-in admins receive these rows.
alter publication supabase_realtime add table public.admins;
alter table public.admins replica identity full;
