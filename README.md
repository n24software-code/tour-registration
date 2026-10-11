# Tour Registration System

Visitors register online for guided bus tours. The Registration team reviews and confirms them, and the
Crowd team checks them in at the pickup area and boards them onto buses. Every admin list is a live
Supabase Realtime subscription, so both teams see each other's changes instantly without refreshing.

**Stack:** Next.js 14 (App Router, TypeScript), Tailwind CSS 3, Supabase (Postgres + Auth + Realtime),
Nodemailer over SMTP.

> **Changelog — October 2026.** The backend moved from Firebase (Firestore + Auth + Cloud Functions) to
> Supabase. No Firebase code, config or data remains; the schema, row level security and the RPCs in
> `supabase/migrations/` are now the whole server. Registrations also moved to a two-batch schedule for
> SABIC and Saudi Aramco.

## Setup

1. **Create the Supabase project** (this repo targets `sxfiapcanvcnvrgpjpid`) and copy
   `.env.example` to `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # safe in the browser
   SUPABASE_SECRET_KEY=sb_secret_...                          # server only, bypasses RLS
   ```
   Use the **new** API keys (`sb_publishable_` / `sb_secret_`), not the legacy anon/service_role JWTs.
   `npm run check-env` lists what is set without printing any value.
2. **Install:** `npm install`
3. **Apply the schema:**
   ```
   npx supabase login                                  # as the account owning the project
   npx supabase link --project-ref sxfiapcanvcnvrgpjpid
   npm run db:push
   ```
   The CLI provisions its own login role through the Management API, so `SUPABASE_DB_PASSWORD` is only
   needed if you connect to Postgres directly.
4. **Seed the tours:** `npm run seed` (add `-- --dry` to see the plan first). Idempotent.
5. **Create the team logins:** `npm run create-admins`, which reads the git-ignored `admins.local.json`
   and writes `test-accounts.local.md` (also git-ignored). Never commit either.
6. **Email:** fill in the `SMTP_*` and `MAIL_FROM` variables — see [Confirmation emails](#confirmation-emails).
7. **Run:** `npm run dev`. Visitors use `/`, staff sign in at `/login`.

## Tours and batches

SABIC and Saudi Aramco each run two departures; the others run once.

| Tour | Batch | Departs | Seats |
|---|---|---|---|
| KAPSARC & Black Gold Museum | — | 08:00 | 50 |
| **SABIC - Home of Innovation** | **1** | **08:00** | **20** |
| **SABIC - Home of Innovation** | **2** | **09:00** | **20** |
| **Saudi Aramco - KAFD** | **1** | **09:00** | **10** |
| **Saudi Aramco - KAFD** | **2** | **10:00** | **10** |
| Heritage Trail - Diriyah | — | 16:30 | 50 |
| Downtown & National History | — | 17:00 | 50 |
| Boulevard City | — | 16:00 | 50 |

Both SABIC batches carry the nationality restriction (IQ, YE, LB, SY). Boulevard City carries its
experience duration and four notices.

**Each batch is its own row in `tours`**, so capacity, `registered_count`, the Crowd list and the Excel
export all work per batch with no special cases. Two columns tie them together: `destination_id`
(shared — `"sabic"`, `"aramco-kafd"`) and `batch` (`1`, `2`, or `null`).

The public form groups by `destination_id` (`lib/destinations.ts`): the destination appears once with a
required **Choose a departure** radio reading *"Batch 1 · 08:00 · 20 seats left"*. **Times and seat
counts always come from the database — never hardcoded in the UI.**

**Defensive rule:** once a destination has any batched row, un-batched rows for it are *hidden*. A
half-finished migration or a stale seed would otherwise offer a departure that no longer exists. This is
covered by `tests/destinations.test.ts`, including the exact case that caused the bug (a leftover
un-batched SABIC showing 08:30 beside the real Batch 1 and Batch 2).

`npm run seed` enforces the same thing in the data: it **deletes** any row whose destination is
`sabic`/`aramco-kafd` but whose id isn't one of the four, and recomputes `registered_count` from the
real number of non-cancelled registrations.

## Database

Five tables, all with row level security. The full schema is in `supabase/migrations/`.

| Table | Purpose |
|---|---|
| `tours` | id, destination_id, batch, name, slot, pickup_point, departure_time, tour_date, capacity, registered_count, active, sort_order, restricted_nationalities, experience_duration, notices |
| `registrations` | code (PK, 6 chars), name, email, phone (E.164), phone_country, id_type, id_number, nationality, tour_id, tour_name, slot, departure_time, batch, tour_date, status, bus_number, flag, accepted_conditions, conditions_accepted_at, timestamps |
| `admins` | user_id → auth.users, email, name, role |
| `audit_logs` | action, reg_code, detail, by_uid, by_email, by_role, at — append-only |
| `email_outbox` | reg_code, to_email, subject, text, html, status, attempts, error, message_id, sent_at |

A **partial unique index** on `(id_type, id_number, tour_id, tour_date) where status <> 'cancelled'`
enforces one identity document per tour per day, while letting a cancelled booking free it again.

### Row level security

`public.current_role()` is `SECURITY DEFINER` so it can read `admins` without a policy recursing into
itself. It is always called schema-qualified, because `CURRENT_ROLE` is a reserved SQL keyword.

| Table | Read | Write |
|---|---|---|
| `tours` | everyone, including anonymous (the public form needs it) | po, pm |
| `registrations` | any admin | **nobody directly** — only the RPCs |
| `admins` | any admin, plus your own row | po |
| `audit_logs` | po, pm | **nobody** — append-only, written by the RPCs |
| `email_outbox` | any admin | **nobody directly** |

Every write to a registration goes through a `SECURITY DEFINER` RPC that re-checks the caller's role and
writes an `audit_logs` entry: `register_visitor`, `confirm_registration`, `set_status`, `set_flag` /
`resolve_flag`, `cancel_registration`, `delete_registration`, `save_tour`, `add_tour`, `queue_resend`,
`log_export`, `set_admin_role`, `remove_admin`.

`register_visitor` is **revoked from `anon` and `authenticated`** — only the secret key can call it. It
runs the whole booking in one transaction: `SELECT … FOR UPDATE` on the tour row, then the active,
restriction, conditions, date, capacity and duplicate checks, then the insert, the seat increment and
the outbox row. The row lock is what makes three simultaneous bids for the last seat resolve to exactly
one booking.

`tours`, `registrations`, `admins` and `email_outbox` are in the `supabase_realtime` publication. RLS
applies to Realtime too, so a subscriber only receives rows its own policies would let it select.

## Roles and permissions

| Permission | PO | PM | Registration | Crowd |
|---|---|---|---|---|
| `viewOverview` | ✓ | ✓ | ✓ | ✓ |
| `manageRegistrations` | ✓ | ✓ | ✓ | |
| `operatePickup` | ✓ | ✓ | | ✓ |
| `manageTours` | ✓ | ✓ | | |
| `manageTeam` | ✓ | | | |
| `deleteRegistrations` | ✓ | | | |
| `resendConfirmation` | ✓ | ✓ | ✓ | |

`lib/roles.ts` drives the UI; the RPCs enforce the same matrix in the database.

## Status pipeline

```
 visitor registers
        ▼
 Pending review ──Confirm──► Confirmed ──Check in──► At pickup ──Board bus N──► On the bus
   (Reg team)                   │  ▲                     │
        │                       │  └──────── Undo ───────┘
        │                       ▼
        │                   No-show  (Undo → Confirmed)
        ▼
   Cancelled  ← Registration team, from any status except On the bus (the seat is released)
```

## Confirmation emails

Every successful registration writes an `email_outbox` row **inside the booking transaction**, so a
registration can never exist without its confirmation queued. `/api/register` then renders and sends it
with Nodemailer from the Node runtime. **A booking never fails because SMTP is down** — the outbox row
is already committed and `/api/outbox/retry` can pick it up.

The message carries the code, tour, batch, date, departure time, pickup point, the Boulevard City
duration and notices when relevant, and a link to `/registered/<code>`. Both a plain-text and an
escaped, inline-styled HTML body are built from one place (`lib/mail.ts`) with absolute logo URLs under
`NEXT_PUBLIC_SITE_URL`. **The ID number never appears in the email or on the public page.**

| Variable | Example |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` (implicit TLS; 587 uses STARTTLS) |
| `SMTP_USER` | `tours@n24.sa` |
| `SMTP_PASS` | the Google Workspace **App Password** — never the account password |
| `MAIL_FROM` | `Tour Registration <tours@n24.sa>` |
| `NEXT_PUBLIC_SITE_URL` | `https://…` — no trailing slash |

Google Workspace is the recommendation for an `@n24.sa` sender: create the mailbox, enable 2-step
verification, then generate an App Password. SendGrid (`smtp.sendgrid.net:465`, user `apikey`) and
Resend (`smtp.resend.com:465`, user `resend`) work the same way. Add the provider's **SPF** include and
**DKIM** CNAME to the `n24.sa` DNS zone, plus a **DMARC** record, or confirmations land in spam.

**Resend** — PO, PM and Registration get a button on each row; it queues a fresh outbox row (the
delivery history is kept) and re-sends, writing a `registration:resend` audit entry.

**Retry** — `POST /api/outbox/retry` re-sends `pending` and `error` rows, up to 3 attempts each. Open to
a signed-in admin with `manageRegistrations`, or to a scheduler presenting `CRON_SECRET` as a bearer
token. For Vercel Cron, add to `vercel.json`:
```json
{ "crons": [{ "path": "/api/outbox/retry", "schedule": "*/10 * * * *" }] }
```

The Registrations page shows each booking's delivery state as **Sent / Pending / Error**, read live from
the `registration_mail_status` view. Diagnose failures with `email_outbox.error`.

## Testing

```
npx tsc --noEmit        # app, e2e and scripts
npm run test:unit       # grouping rules + the email sender against a local SMTP catcher
npm run test:e2e        # Playwright, desktop + mobile, against the real Supabase project
```

The e2e suite covers the batch schedule, a full batch, three parallel bids for the last seat, the SABIC
restriction on both batches, Realtime between the Registration and Crowd pages, one outbox row per
registration, the Excel export, the National ID / passport switch, the country-code phone field,
Boulevard City's notices, PO delete, the logos, and the RLS matrix per role. Teardown removes only e2e
data and restores every tour from a snapshot.

## Deploying to Vercel

Set these environment variables in the Vercel project (Settings → Environment Variables):

| Add | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | |
| `SUPABASE_SECRET_KEY` | mark as sensitive |
| `NEXT_PUBLIC_SITE_URL` | the production origin |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | `SMTP_PASS` sensitive |
| `CRON_SECRET` | only if you schedule the retry route |

**Remove** every `FIREBASE_*`, `NEXT_PUBLIC_FIREBASE_*` and `ENABLE_CONFIRMATION_EMAIL` variable — they
are dead.

In the Supabase dashboard, set **Authentication → URL Configuration → Site URL** to the production
origin and add it to the redirect allow-list. Then redeploy.

## Production checklist

- [ ] **Bot protection on `/api/register`:** Cloudflare Turnstile or reCAPTCHA, plus IP rate limiting.
- [ ] **Backups:** Supabase daily backups (Pro) or scheduled `pg_dump`.
- [ ] **Accounts:** ask everyone to change their temporary password, and remove the throwaway
      `@tour.test` logins before launch.
- [ ] **Email deliverability:** SPF, DKIM and DMARC on `n24.sa`; send a test and check it isn't filtered.
- [ ] **Next.js:** pinned to Next 14. 14.2.x is the final 14 line, and some advisories are only fixed in
      15+, so plan an upgrade.

## Project layout

```
app/
  page.tsx                  public registration form
  registered/[code]/        confirmation page (server component, secret key)
  login/                    staff sign-in
  admin/                    layout + overview, registrations, crowd, tours, team
  api/register/             public booking endpoint → register_visitor RPC → email
  api/admins/               PO-only: create a team login
  api/resend-confirmation/  re-queue and re-send one confirmation
  api/outbox/retry/         retry failed sends (admin or cron)
lib/
  supabase/client.ts        browser client (publishable key)
  supabase/server.ts        server client with cookies (@supabase/ssr)
  supabase/admin.ts         secret key, "server-only"
  supabase/types.ts         row types + snake_case ⇄ camelCase mappers
  actions.ts                the RPC calls, with Postgres errors mapped to plain words
  hooks.ts                  initial select + Realtime postgres_changes
  destinations.ts           destination/batch grouping for the public form
  mail.ts / mailer.ts / smtp.ts   the message, the sender, the pure SMTP helpers
supabase/migrations/        schema, RLS, RPCs, realtime
scripts/seed.mjs            the tours (idempotent, --dry)
scripts/create-admins.mjs   team logins from admins.local.json
tests/                      unit tests (node:test)
e2e/                        Playwright
```
