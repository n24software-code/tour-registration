-- Tour registration: core schema.
--
-- Column names are snake_case; lib/types.ts maps them to the camelCase the app uses.
-- Every table gets row level security in the next migration — none is reachable
-- directly from a browser except where a policy says so.

-- ---------------------------------------------------------------- tours
create table public.tours (
  id                       text primary key,
  -- Groups the batches of one destination ("sabic"); its own id when it has none.
  destination_id           text not null,
  -- 1, 2, … for a batched tour; null for a tour that runs once.
  batch                    int,
  name                     text not null,
  slot                     text not null check (slot in ('morning', 'evening')),
  pickup_point             text not null default 'Main pickup area',
  departure_time           time not null,
  -- Null means "any future date"; set means the tour only runs that day.
  tour_date                date,
  capacity                 int  not null check (capacity > 0),
  registered_count         int  not null default 0 check (registered_count >= 0),
  active                   boolean not null default true,
  sort_order               int  not null default 0,
  -- ISO 3166-1 alpha-2 codes that may NOT join this tour.
  restricted_nationalities text[] not null default '{}',
  experience_duration      text,
  -- Conditions a visitor must accept before booking.
  notices                  text[] not null default '{}',
  -- The seat counter can never exceed the seats that exist.
  constraint tours_count_within_capacity check (registered_count <= capacity)
);

create index tours_destination_idx on public.tours (destination_id, batch);
create index tours_sort_idx        on public.tours (sort_order, departure_time);

-- ---------------------------------------------------------------- registrations
create table public.registrations (
  -- The confirmation code is the primary key: 6 characters, no 0/O/1/I.
  code                   text primary key
                           check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  name                   text not null,
  email                  text not null,
  -- E.164, e.g. "+966501234567".
  phone                  text not null,
  phone_country          text not null,
  id_type                text not null check (id_type in ('national_id', 'passport')),
  id_number              text not null,
  nationality            text not null,
  tour_id                text not null references public.tours (id) on delete restrict,
  -- Denormalised at booking time so a later tour edit never rewrites history.
  tour_name              text not null,
  slot                   text not null check (slot in ('morning', 'evening')),
  departure_time         time,
  batch                  int,
  tour_date              date not null,
  status                 text not null default 'pending'
                           check (status in ('pending', 'confirmed', 'checked_in',
                                             'boarded', 'no_show', 'cancelled')),
  bus_number             text,
  flag                   text,
  accepted_conditions    boolean not null default false,
  conditions_accepted_at timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             text,
  checked_in_at          timestamptz,
  boarded_at             timestamptz
);

-- One identity document per tour per day. A cancelled booking frees it again, which
-- is why this is a partial index rather than a plain unique constraint.
create unique index registrations_one_per_trip
  on public.registrations (id_type, id_number, tour_id, tour_date)
  where status <> 'cancelled';

create index registrations_tour_idx    on public.registrations (tour_id, tour_date);
create index registrations_created_idx on public.registrations (created_at desc);
create index registrations_status_idx  on public.registrations (status);

-- ---------------------------------------------------------------- admins
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email   text not null unique,
  name    text not null,
  role    text not null check (role in ('po', 'pm', 'registration', 'crowd'))
);

-- ---------------------------------------------------------------- audit_logs
-- Append-only: no policy grants update or delete to anyone.
create table public.audit_logs (
  id        bigserial primary key,
  action    text not null,
  reg_code  text,
  detail    text,
  by_uid    uuid,
  by_email  text,
  by_role   text,
  at        timestamptz not null default now()
);

create index audit_logs_reg_idx on public.audit_logs (reg_code);
create index audit_logs_at_idx  on public.audit_logs (at desc);

-- ---------------------------------------------------------------- email_outbox
create table public.email_outbox (
  id         uuid primary key default gen_random_uuid(),
  reg_code   text references public.registrations (code) on delete cascade,
  to_email   text not null,
  -- The rendered bodies are filled in by the route that sends them, a moment after
  -- register_visitor commits. They are nullable so the row can be created inside the
  -- booking transaction — that is what guarantees a registration always has an outbox
  -- row. /api/outbox/retry re-renders from reg_code if a crash left them null.
  subject    text,
  "text"     text,
  html       text,
  status     text not null default 'pending' check (status in ('pending', 'sent', 'error')),
  attempts   int  not null default 0,
  error      text,
  message_id text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);

create index email_outbox_status_idx on public.email_outbox (status, created_at);
create index email_outbox_reg_idx    on public.email_outbox (reg_code);

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger registrations_touch_updated_at
  before update on public.registrations
  for each row execute function public.touch_updated_at();
