-- Every write to registrations goes through one of these.
--
-- They are SECURITY DEFINER, so they bypass RLS on purpose — which is exactly why each
-- one re-checks the caller's role first. The route handlers map the typed errors they
-- return to the same plain-language messages the app has always shown.

-- ---------------------------------------------------------------- audit helper
create or replace function public.write_audit(
  p_action text, p_reg_code text, p_detail text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.admins;
begin
  select * into a from public.admins where user_id = auth.uid();
  insert into public.audit_logs (action, reg_code, detail, by_uid, by_email, by_role)
  -- A null uid means the server acted on a visitor's behalf (/api/register).
  values (p_action, p_reg_code, p_detail, auth.uid(), coalesce(a.email, 'visitor'),
          coalesce(a.role, 'system'));
end;
$$;
revoke all on function public.write_audit(text, text, text) from public, anon, authenticated;

-- Raises unless the caller holds one of `allowed`.
create or replace function public.require_role(allowed text[])
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r text := public.current_role();
begin
  if r is null or not (r = any (allowed)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return r;
end;
$$;
revoke all on function public.require_role(text[]) from public;
grant execute on function public.require_role(text[]) to authenticated;

-- ---------------------------------------------------------------- register_visitor
-- Called only by the server with the secret key. One transaction: lock the tour, check
-- every rule, insert the registration, take the seat, queue the confirmation.
create or replace function public.register_visitor(
  p_name                text,
  p_email               text,
  p_phone               text,
  p_phone_country       text,
  p_id_type             text,
  p_id_number           text,
  p_nationality         text,
  p_tour_id             text,
  p_tour_date           date,
  p_accepted_conditions boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t         public.tours;
  v_code    text;
  v_outbox  uuid;
  v_i       int;
  alphabet  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  -- FOR UPDATE serialises concurrent bookings for this tour, so the last seat can
  -- only ever be taken once however many requests arrive together.
  select * into t from public.tours where id = p_tour_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'tour_missing', 'field', 'tourId');
  end if;

  if not t.active then
    return jsonb_build_object('ok', false, 'error', 'tour_closed', 'field', 'tourId');
  end if;

  if p_nationality = any (t.restricted_nationalities) then
    return jsonb_build_object(
      'ok', false, 'error', 'nationality_restricted', 'field', 'nationality',
      'tourName', t.name, 'restricted', to_jsonb(t.restricted_nationalities));
  end if;

  if cardinality(t.notices) > 0 and coalesce(p_accepted_conditions, false) = false then
    return jsonb_build_object('ok', false, 'error', 'conditions_required',
                              'field', 'acceptedConditions');
  end if;

  if t.tour_date is not null and t.tour_date <> p_tour_date then
    return jsonb_build_object('ok', false, 'error', 'wrong_date', 'field', 'tourDate',
                              'tourDate', to_char(t.tour_date, 'YYYY-MM-DD'));
  end if;

  if t.registered_count >= t.capacity then
    return jsonb_build_object('ok', false, 'error', 'tour_full', 'field', 'tourId');
  end if;

  if exists (
    select 1 from public.registrations r
    where r.id_type = p_id_type and r.id_number = p_id_number
      and r.tour_id = p_tour_id and r.tour_date = p_tour_date
      and r.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'error', 'duplicate_id', 'field', 'idNumber',
                              'idType', p_id_type);
  end if;

  -- A 6-character code that isn't taken. 32^6 is ample; 20 tries is paranoia.
  for v_i in 1 .. 20 loop
    select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '')
      into v_code
      from generate_series(1, 6);
    exit when not exists (select 1 from public.registrations where code = v_code);
    v_code := null;
  end loop;
  if v_code is null then
    return jsonb_build_object('ok', false, 'error', 'code_generation');
  end if;

  insert into public.registrations (
    code, name, email, phone, phone_country, id_type, id_number, nationality,
    tour_id, tour_name, slot, departure_time, batch, tour_date,
    status, accepted_conditions, conditions_accepted_at, updated_by
  ) values (
    v_code, p_name, p_email, p_phone, p_phone_country, p_id_type, p_id_number, p_nationality,
    t.id, t.name, t.slot, t.departure_time, t.batch, p_tour_date,
    'pending', coalesce(p_accepted_conditions, false),
    case when cardinality(t.notices) > 0 then now() end,
    'visitor'
  );

  update public.tours set registered_count = registered_count + 1 where id = t.id;

  -- Queued in the same transaction, so a registration can never exist without its
  -- confirmation waiting to go out. The route fills in the rendered bodies next.
  insert into public.email_outbox (reg_code, to_email)
  values (v_code, p_email)
  returning id into v_outbox;

  perform public.write_audit('registration:create', v_code,
    t.name || coalesce(' – Batch ' || t.batch, '') || ' · ' || to_char(p_tour_date, 'YYYY-MM-DD'));

  return jsonb_build_object(
    'ok', true,
    'code', v_code,
    'outboxId', v_outbox,
    'tour', jsonb_build_object(
      'name', t.name,
      'batch', t.batch,
      'slot', t.slot,
      'departureTime', to_char(t.departure_time, 'HH24:MI'),
      'pickupPoint', t.pickup_point,
      'experienceDuration', t.experience_duration,
      'notices', to_jsonb(t.notices)
    )
  );
end;
$$;
-- Server-only: the secret key bypasses these grants, nobody else may call it.
revoke all on function public.register_visitor(
  text, text, text, text, text, text, text, text, date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- pipeline
-- The allowed moves, identical to the matrix lib/actions.ts has always enforced.
create or replace function public.set_status(
  p_code text, p_status text, p_bus_number text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      public.registrations;
  caller text;
  ok     boolean;
begin
  -- Confirming belongs to the registration desk; the pickup moves belong to Crowd.
  if p_status = 'confirmed' then
    caller := public.require_role(array['po', 'pm', 'registration', 'crowd']);
  else
    caller := public.require_role(array['po', 'pm', 'crowd']);
  end if;

  select * into r from public.registrations where code = p_code for update;
  if not found then
    raise exception 'This registration no longer exists.' using errcode = 'P0002';
  end if;

  ok := case r.status
          when 'pending'    then p_status = 'confirmed'
          when 'confirmed'  then p_status in ('checked_in', 'no_show')
          when 'checked_in' then p_status in ('boarded', 'confirmed')  -- confirmed = undo
          when 'no_show'    then p_status = 'confirmed'                -- undo
          else false
        end;
  if not ok then
    raise exception 'Can''t move a visitor from "%" to "%". Refresh and try again.',
      r.status, p_status using errcode = 'P0001';
  end if;

  -- Only the registration desk may make the first confirmation.
  if r.status = 'pending' and caller = 'crowd' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_status = 'boarded' and coalesce(btrim(p_bus_number), '') = '' then
    raise exception 'Enter the bus number first.' using errcode = 'P0001';
  end if;

  update public.registrations
     set status        = p_status,
         bus_number    = case when p_status = 'boarded' then btrim(p_bus_number) else bus_number end,
         checked_in_at = case when p_status = 'checked_in' then now() else checked_in_at end,
         boarded_at    = case when p_status = 'boarded' then now() else boarded_at end,
         updated_by    = coalesce((select email from public.admins where user_id = auth.uid()), 'system')
   where code = p_code;

  perform public.write_audit(
    case when p_status = 'confirmed' and r.status <> 'pending'
         then 'undo:' || r.status else 'status:' || p_status end,
    p_code,
    case when p_status = 'boarded' then 'bus ' || btrim(p_bus_number) end);
end;
$$;
grant execute on function public.set_status(text, text, text) to authenticated;

create or replace function public.confirm_registration(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_role(array['po', 'pm', 'registration']);
  perform public.set_status(p_code, 'confirmed');
end;
$$;
grant execute on function public.confirm_registration(text) to authenticated;

-- ---------------------------------------------------------------- flags
create or replace function public.set_flag(p_code text, p_message text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Crowd raises a flag; the desk roles resolve it. Passing null is "resolved".
  if p_message is null then
    perform public.require_role(array['po', 'pm', 'registration', 'crowd']);
  else
    perform public.require_role(array['po', 'pm', 'crowd']);
  end if;

  if not exists (select 1 from public.registrations where code = p_code) then
    raise exception 'This registration no longer exists.' using errcode = 'P0002';
  end if;

  update public.registrations
     set flag = p_message,
         updated_by = coalesce((select email from public.admins where user_id = auth.uid()), 'system')
   where code = p_code;

  perform public.write_audit(
    case when p_message is null then 'flag:resolved' else 'flag:raised' end, p_code, p_message);
end;
$$;
grant execute on function public.set_flag(text, text) to authenticated;

create or replace function public.resolve_flag(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_role(array['po', 'pm', 'registration']);
  perform public.set_flag(p_code, null);
end;
$$;
grant execute on function public.resolve_flag(text) to authenticated;

-- ---------------------------------------------------------------- cancel / delete
create or replace function public.cancel_registration(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.registrations;
begin
  perform public.require_role(array['po', 'pm', 'registration']);

  select * into r from public.registrations where code = p_code for update;
  if not found then
    raise exception 'This registration no longer exists.' using errcode = 'P0002';
  end if;
  if r.status = 'cancelled' then return; end if;
  if r.status = 'boarded' then
    raise exception 'This visitor is already on the bus and can''t be cancelled.'
      using errcode = 'P0001';
  end if;

  update public.registrations
     set status = 'cancelled',
         updated_by = coalesce((select email from public.admins where user_id = auth.uid()), 'system')
   where code = p_code;

  -- The seat goes back to the tour.
  update public.tours set registered_count = greatest(registered_count - 1, 0)
   where id = r.tour_id;

  perform public.write_audit('status:cancelled', p_code, 'was ' || r.status);
end;
$$;
grant execute on function public.cancel_registration(text) to authenticated;

create or replace function public.delete_registration(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.registrations;
begin
  perform public.require_role(array['po']);

  select * into r from public.registrations where code = p_code for update;
  if not found then
    raise exception 'This registration no longer exists.' using errcode = 'P0002';
  end if;

  -- A cancelled booking already handed its seat back; decrementing twice would lose one.
  if r.status <> 'cancelled' then
    update public.tours set registered_count = greatest(registered_count - 1, 0)
     where id = r.tour_id;
  end if;

  delete from public.registrations where code = p_code;

  perform public.write_audit('registration:delete', p_code,
    r.name || ' · ' || (case r.id_type when 'national_id' then 'National ID' else 'Passport' end)
    || ' ' || r.id_number || ' · ' || r.tour_name || ' · ' || to_char(r.tour_date, 'YYYY-MM-DD'));
end;
$$;
grant execute on function public.delete_registration(text) to authenticated;

-- ---------------------------------------------------------------- tours
create or replace function public.save_tour(p_id text, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  taken int;
  want  int := (p_fields ->> 'capacity')::int;
begin
  perform public.require_role(array['po', 'pm']);

  select registered_count into taken from public.tours where id = p_id for update;
  if not found then
    raise exception 'This tour no longer exists.' using errcode = 'P0002';
  end if;
  if want < taken then
    raise exception 'Capacity can''t be lower than the % people already registered.', taken
      using errcode = 'P0001';
  end if;

  update public.tours set
    name                     = btrim(p_fields ->> 'name'),
    destination_id           = coalesce(nullif(btrim(p_fields ->> 'destinationId'), ''), id),
    batch                    = nullif(p_fields ->> 'batch', '')::int,
    slot                     = p_fields ->> 'slot',
    pickup_point             = btrim(p_fields ->> 'pickupPoint'),
    departure_time           = (p_fields ->> 'departureTime')::time,
    tour_date                = nullif(p_fields ->> 'tourDate', '')::date,
    capacity                 = want,
    active                   = (p_fields ->> 'active')::boolean,
    restricted_nationalities = coalesce(
      array(select jsonb_array_elements_text(p_fields -> 'restrictedNationalities')), '{}'),
    experience_duration      = nullif(btrim(coalesce(p_fields ->> 'experienceDuration', '')), ''),
    notices                  = coalesce(
      array(select btrim(v) from jsonb_array_elements_text(p_fields -> 'notices') v
            where btrim(v) <> ''), '{}')
  where id = p_id;

  perform public.write_audit('tour:update', null, p_id || ': ' || (p_fields ->> 'name'));
end;
$$;
grant execute on function public.save_tour(text, jsonb) to authenticated;

create or replace function public.add_tour(p_fields jsonb, p_sort_order int)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id text;
begin
  perform public.require_role(array['po', 'pm']);

  -- A readable id derived from the name, with the batch appended so two batches of one
  -- destination never collide.
  new_id := regexp_replace(lower(btrim(p_fields ->> 'name')), '[^a-z0-9]+', '-', 'g');
  new_id := btrim(new_id, '-');
  if coalesce(p_fields ->> 'batch', '') <> '' then
    new_id := new_id || '-b' || (p_fields ->> 'batch');
  end if;
  if new_id = '' or exists (select 1 from public.tours where id = new_id) then
    new_id := new_id || '-' || substr(gen_random_uuid()::text, 1, 6);
  end if;

  insert into public.tours (
    id, destination_id, batch, name, slot, pickup_point, departure_time, tour_date,
    capacity, registered_count, active, sort_order,
    restricted_nationalities, experience_duration, notices
  ) values (
    new_id,
    coalesce(nullif(btrim(p_fields ->> 'destinationId'), ''), new_id),
    nullif(p_fields ->> 'batch', '')::int,
    btrim(p_fields ->> 'name'),
    p_fields ->> 'slot',
    btrim(p_fields ->> 'pickupPoint'),
    (p_fields ->> 'departureTime')::time,
    nullif(p_fields ->> 'tourDate', '')::date,
    (p_fields ->> 'capacity')::int,
    0,
    (p_fields ->> 'active')::boolean,
    p_sort_order,
    coalesce(array(select jsonb_array_elements_text(p_fields -> 'restrictedNationalities')), '{}'),
    nullif(btrim(coalesce(p_fields ->> 'experienceDuration', '')), ''),
    coalesce(array(select btrim(v) from jsonb_array_elements_text(p_fields -> 'notices') v
                   where btrim(v) <> ''), '{}')
  );

  perform public.write_audit('tour:add', null, new_id || ': ' || (p_fields ->> 'name'));
  return new_id;
end;
$$;
grant execute on function public.add_tour(jsonb, int) to authenticated;

-- ---------------------------------------------------------------- exports / resend
create or replace function public.log_export(p_detail text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_role(array['po', 'pm', 'registration']);
  perform public.write_audit('registrations:export', null, p_detail);
end;
$$;
grant execute on function public.log_export(text) to authenticated;
