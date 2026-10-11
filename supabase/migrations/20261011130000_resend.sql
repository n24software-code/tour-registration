-- Re-queueing a booking confirmation.
--
-- A new outbox row rather than resetting the old one: the delivery history stays
-- intact, and the badge follows the newest row for that registration.
create or replace function public.queue_resend(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      public.registrations;
  new_id uuid;
begin
  perform public.require_role(array['po', 'pm', 'registration']);

  select * into r from public.registrations where code = p_code;
  if not found then
    raise exception 'This registration no longer exists.' using errcode = 'P0002';
  end if;
  if coalesce(btrim(r.email), '') = '' then
    raise exception 'This registration has no email address to send to.' using errcode = 'P0001';
  end if;

  insert into public.email_outbox (reg_code, to_email)
  values (r.code, r.email)
  returning id into new_id;

  perform public.write_audit('registration:resend', p_code, r.email || ' · outbox ' || new_id);
  return new_id;
end;
$$;
grant execute on function public.queue_resend(text) to authenticated;

-- The newest outbox row per registration — what the Sent / Pending / Error badge reads,
-- so the UI doesn't have to carry a mail id on the registration itself.
create or replace view public.registration_mail_status
with (security_invoker = true) as
select distinct on (o.reg_code)
  o.reg_code,
  o.id as outbox_id,
  o.status,
  o.attempts,
  o.error,
  o.sent_at,
  o.created_at
from public.email_outbox o
where o.reg_code is not null
order by o.reg_code, o.created_at desc;

grant select on public.registration_mail_status to authenticated;
