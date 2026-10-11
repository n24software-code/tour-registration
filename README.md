# Tour Registration System

Visitors register online for guided bus tours. The Registration team reviews and confirms them, and the Crowd
team checks them in at the pickup area and boards them onto buses. Every admin list is a live Firestore
listener, so both teams see each other's changes instantly without refreshing.

**Stack:** Next.js 14 (App Router, TypeScript), Tailwind CSS 3, Firebase Auth + Firestore, Firebase Admin SDK.

## Setup

1. **Firebase console** (project `tour-registration-1727d`):
   - Build → **Authentication** → Sign-in method → enable **Email/Password**.
   - Build → **Firestore Database** → Create database (production mode).
   - Project settings → **Service accounts** → *Generate new private key*.
2. **Environment.** `.env.local` already holds the public web config. From the service-account JSON, fill in:
   ```
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxx@tour-registration-1727d.iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   ```
   Keep the key in one line with literal `\n` and wrap it in double quotes. Never commit `.env.local`.
3. **Install:** `npm install`
4. **Deploy rules and indexes:**
   ```
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules,firestore:indexes
   ```
5. **Seed the 5 tours and the first Product Owner:**
   ```
   npm run seed -- owner@example.com "Owner Name" "TempPassword123"
   ```
   Safe to re-run: existing tours are skipped and an existing login is reused.
6. **Backfill tour restrictions** on a database seeded before `restrictedNationalities` existed:
   ```
   npm run migrate
   ```
   Sets `["IQ","YE","LB","SY"]` on the SABIC tour and `[]` on every other tour. Safe to re-run.
7. **Partner logos** live in `public/logos/` and are already in the repo:
   | File | Logo | Alt text |
   |------|------|----------|
   | `logo3.png` | Ministry of Energy | `Ministry of Energy` |
   | `logo2.png` | 25th WPC Energy Congress | `25th WPC Energy Congress, 11–15 October 2026` |
   | `logo1.png` | WPC Energy | `WPC Energy` |

   `components/Logos.tsx` renders them in that order, left to right, with thin dividers. The row is
   forced to `dir="ltr"`, so an Arabic page keeps the agreed order instead of mirroring it. The imports
   are static, so `next/image` bakes in each file's real dimensions and nothing shifts while they load;
   each image is sized by height with `w-auto`, so they always share a visible height and are never
   cropped or distorted.

   To replace one, drop in a new PNG and optimise it to 600px wide:
   ```
   npx sharp-cli -i public/logos/logo1.png -o public/logos/ resize 600 --withoutEnlargement
   ```
   Keep transparency by encoding with `png({ compressionLevel: 9 })` — **not** `palette: true`, which
   flattens the alpha channel.
8. **Booking confirmation emails.** `NEXT_PUBLIC_SITE_URL` and `MAIL_FROM` go in `.env.local`
   (see `.env.example`), and the **Trigger Email from Firestore** extension does the sending —
   see [Confirmation emails](#confirmation-emails) below for the one-time setup.
9. **Run:** `npm run dev`. Visitors use `/`, and staff sign in at `/login`. The PO adds the rest of the team under **Team**.

Edit pickup points, dates, times, capacity, nationality restrictions and trip information on the
**Tours** page after seeding.

## The registration form

Every field is required, in this order:

| Field               | Rules                                                                                               |
|---------------------|-----------------------------------------------------------------------------------------------------|
| **Full name**       | 2–100 characters.                                                                                   |
| **Mobile number**   | A searchable country selector (flag, name, dial code — every country `libphonenumber-js` knows, Saudi Arabia first and the default) plus the national number. Validated with `libphonenumber-js/min`: the number has to be valid **for the selected country**. Stored as `phone` in E.164 (`+966501234567`) and `phoneCountry` (ISO2). Choosing a nationality pre-selects its dial code until the visitor picks one themselves. |
| **Nationality**     | Searchable list of every ISO 3166-1 country's demonym (`lib/nationalities.ts`), Saudi pinned first. The ISO alpha-2 **code** is stored; the label is what's shown. |
| **National ID / Passport** | One field whose meaning follows the nationality — see [Identity](#identity-national-id-or-passport). Disabled until a nationality is chosen. |
| **Tour / Destination** | The morning/evening tour cards.                                                                  |
| **Date**            | Filled in and read-only when the tour has a fixed `date`; otherwise a date picker with `min` = today (Asia/Riyadh). |
| **Email**           | Required. Stored lowercase. The booking confirmation is sent here.                                   |
| **Conditions**      | A tour that carries `notices` shows them before the date, with a required checkbox. See [Trip information](#trip-information-and-conditions). |

`lib/validation.ts` holds the single copy of these rules; the form and `/api/register` both call
`normalize()` then `validate()`, and failures come back as `{ errors: { field: message } }`.

**One identity document per tour per day.** `/api/register` refuses a second registration with the same
`idType` + `idNumber` + `tourId` + `tourDate` unless the existing one is cancelled —
*"This National ID / passport is already registered for this tour on this date."* The composite index for
that query lives in `firestore.indexes.json`.

The ID number is never shown on the public `/registered/[code]` page, and never appears in the
confirmation email. Registrations created before these fields existed keep working everywhere and
render as `—`.

### Identity: National ID or passport

| Nationality | Label | Rules | Error |
|-------------|-------|-------|-------|
| Saudi (`SA`) | National ID number | Exactly 10 digits starting with `1`, with a valid check digit (Luhn, doubling from the left — `lib/saudi-id.ts`). `inputMode="numeric"`. | *Enter your 10-digit National ID number (it starts with 1).* |
| Anything else | Passport number | Letters and digits only, 5–20 characters, uppercased. | *Enter your passport number as shown in your passport (letters and numbers only).* |
| Not chosen yet | — | Field disabled, hint reads *Choose your nationality first*. | — |

Switching between Saudi and non-Saudi clears the field and swaps the label, hint, `inputMode` and
validation; the hint is in an `aria-live` region so the change is announced. **The server re-derives
`idType` from the nationality and ignores whatever the client sends**, so a passport can never be filed
as a National ID or the other way round. Both halves are stored: `idType` (`national_id` | `passport`)
and `idNumber`.

## Trip information and conditions

A tour can carry two optional fields, edited by PO/PM on the **Tours** page and shown to visitors:

- `experienceDuration` — free text, e.g. *15–20 minutes from entering the experience venue*.
- `notices: string[]` — conditions a visitor must read before booking.

They are rendered as a **Before you book** panel on the public form, and **only while that tour is
selected** — it disappears when another tour is chosen and never appears for a tour without them. The
panel sits in an `aria-live="polite"` region, duration first, then the notices as a list. The same
information appears on `/registered/[code]`, in the confirmation email, and read-only in the
Registrations and Crowd views for that trip.

**When a tour has notices, the checkbox *"I have read these conditions and confirm they don't apply to
me."* is required** — on the client and again in the `/api/register` transaction (`acceptedConditions:
true`). The moment of consent is stored as `conditionsAcceptedAt`.

Boulevard City is the tour this was built for; `scripts/migrate.mjs` and `scripts/seed.mjs` set its
duration and its four notices. Nothing about it is special-cased in code — any tour given `notices`
behaves the same way.

## Confirmation emails

Every successful registration writes a `mail/{id}` document **inside the same transaction** as the
registration, so neither can exist without the other. Delivery is then the
[Trigger Email from Firestore](https://extensions.dev/extensions/firebase/firestore-send-email)
extension's job — the app never talks to an SMTP server, and a delivery failure later cannot fail a
booking. The registration keeps the document id in `mailId`, and the Registrations page shows the
state the extension writes back to `delivery.state` as **Sent / Pending / Error** beside the address.

`lib/mail.ts` builds both bodies from one place: a plain-text part and an inline-styled, accessible
HTML part with the logos as absolute URLs under `NEXT_PUBLIC_SITE_URL`. Every visitor-supplied value is
escaped. The message carries the first name, the code in large print, tour, date, departure time,
pickup point, *"Arrive 15 minutes before departure"*, the tour's duration and notices when it has them,
and a link to `/registered/<code>`. Subject: `Booking confirmed – <Tour> – <CODE>`.

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SITE_URL` | Absolute origin for the logo images and the booking link. No trailing slash. |
| `MAIL_FROM` | The From address. Omit to use the extension's own default sender. |

### Installing the extension (one time, needs the Blaze plan)

1. **Upgrade the project to Blaze.** Extensions run on Cloud Functions, which the free plan doesn't cover.
2. **Choose an SMTP provider** and get its credentials:
   - *Google Workspace* (for an `@n24.sa` sender) — create a dedicated user, turn on 2-step
     verification, generate an **App Password**, and use `smtps://USER%40n24.sa@smtp.gmail.com:465`.
     Simple, but subject to Workspace's daily send limits.
   - *SendGrid* — `smtps://apikey@smtp.sendgrid.net:465`, password = the API key.
   - *Resend* — `smtps://resend@smtp.resend.com:465`, password = the API key.
3. **Install it:** `npx firebase-tools ext:install firebase/firestore-send-email --project tour-registration-1727d`
   and answer:
   | Setting | Value |
   |---------|-------|
   | Email documents collection | `mail` |
   | Default FROM address | the same address as `MAIL_FROM` |
   | SMTP connection URI | from step 2 |
   | SMTP password | the app password or API key (stored in Secret Manager) |
   | Users/templates collections | leave empty |
4. **Authenticate the domain** with the provider so mail isn't filtered: add its **SPF** include and
   **DKIM** CNAME records to the `n24.sa` DNS zone, and a `DMARC` record if there isn't one. Google
   Workspace senders already have SPF/DKIM if the domain is set up for mail.
5. **Authorized domains:** add the production host under Authentication → Settings → Authorized domains,
   and set `NEXT_PUBLIC_SITE_URL` to the same origin so the links in the email resolve.
6. **Check it:** register once and watch `delivery.state` on the new `mail` document go
   `PENDING → PROCESSING → SUCCESS`. The Registrations page shows the same thing.

Until the extension is installed the documents simply accumulate, the UI shows **Queued**, and
registration is unaffected.

## Nationality restrictions (the SABIC rule)

Each tour document carries `restrictedNationalities: string[]` — ISO alpha-2 codes that may not join it.
The SABIC tour (`sabic-home-of-innovation`) is seeded with `["IQ","YE","LB","SY"]`; every other tour gets `[]`.

- **Server (authoritative):** `/api/register` checks the list inside its transaction and answers 409 with
  *"Visitors with Iraqi, Yemeni, Lebanese or Syrian nationality can't join the SABIC tour. Please choose
  another tour."* The message is built from the tour's own list, so editing the list changes the wording.
- **Client:** choosing a restricted nationality disables that tour's card and prints the reason on it. If
  the tour was already selected, the selection is cleared and the message is shown.
- **Admin:** PO/PM edit the list per tour on the **Tours** page with a multi-select over the same list.

## Trips: destination + date + departure time

Because one tour can run on several days, the admin pages group by **trip** — tour + date + departure time
(`lib/trips.ts`, key `tourId|date|departureTime`). The **Registrations** page shows one collapsible section
per trip (sorted by date, then time, then tour order) with live counts and its own Excel export;
**Overview** shows one row per trip; and the **Crowd** page's picker selects a single trip, so a team
running the 08:00 bus never sees tomorrow's passengers. Flagged rows stay highlighted and sort to the top
of their section, and the search and tour/status filters work across every section (empty ones are hidden
while filtering).

### Participant counts

Every trip heading leads with the headline number — **"37 registered · 13 seats left (50)"** — followed by
the breakdown: pending, confirmed, at pickup, on bus, no-show, flagged (and cancelled, when there are any).
"Registered" means every status *except* cancelled. `tripCounts()` in `lib/trips.ts` is the single
definition, so the Registrations sections, the Overview rows and the Crowd trip picker can never disagree.
All of them are live Firestore listeners, so the numbers move as people register, get confirmed or cancel.

`tours/{id}.registeredCount` is the seat counter the booking transaction maintains, and counting
non-cancelled registrations has to give the same answer. If the two ever drift — a lost write would do it —
a **count mismatch** warning appears on the trip heading and the Overview row. It is shown only to PO/PM,
who are the ones who can correct the tour.

### Excel export

Each section has a **Save / Export** button, and the page has **Export all (Excel)** for the current
filtered view. Both produce a real `.xlsx` (via `exceljs`, which is pulled in with a dynamic `import()` on
click so it never reaches the page bundle; the npm `xlsx` package is deliberately avoided because of its
unpatched advisories).

| | |
|---|---|
| **Columns** | `Code, Full name, Mobile, ID type, ID number, Nationality, Email, Tour, Date, Departure time, Pickup point, Status, Bus, Flag, Registered at` |
| **Layout** | A title row naming the tour, date and time; a bold header row, frozen; auto-filter on; column widths set |
| **Types** | Dates are real Excel dates. Mobile and ID number are forced to text (`@`), so a leading zero and a leading `+` survive |
| **Safety** | Values starting with `=`, `+`, `-` or `@` are apostrophe-prefixed. Mobile and ID number are exempt: they are text-formatted cells, which Excel never evaluates, and a phone's `+` is meaningful |
| **Cancelled** | Included and clearly labelled (clay italic), but excluded from every count |
| **File name** | `<tour-name>_<YYYY-MM-DD>_<HHmm>.xlsx`, the date and time being the trip's own |
| **Export all** | One worksheet per trip, plus a **Summary** sheet (first) listing each trip with its counts |

Anyone with `manageRegistrations` (PO, PM, Registration) can export; every export writes an
`auditLogs` entry (`registrations:export`) naming the trip and the row count.

## Roles and permissions

Roles are stored in `admins/{uid}` as `{ email, name, role }`. The UI matrix lives in `lib/roles.ts` (`can(role, permission)`),
and `firestore.rules` enforces the same rules on the server.

| Permission            | What it allows                                         | PO | PM | Registration | Crowd |
|-----------------------|--------------------------------------------------------|----|----|--------------|-------|
| `viewOverview`        | Overview dashboard                                     | ✓  | ✓  | ✓            | ✓     |
| `manageRegistrations` | Confirm, cancel, search, export to Excel, resolve flags | ✓  | ✓  | ✓            |       |
| `operatePickup`       | Check in, board bus, no-show, undo, flag issue         | ✓  | ✓  |              | ✓     |
| `manageTours`         | Edit/add tours, capacity, open/close registration      | ✓  | ✓  |              |       |
| `manageTeam`          | Add members, change roles, remove access               | ✓  |    |              |       |
| `deleteRegistrations` | Delete a registration for good (seat released, audited) | ✓  |    |              |       |

**Deleting (PO only).** The Delete button opens a proper modal — focus moves into it and is trapped,
Escape closes it, and focus returns to the button afterwards — showing the name, code, passport, tour,
date and departure time, and the warning *"This permanently deletes the registration and can't be undone."*
It offers **Delete registration** and **Keep it**. Confirming runs a transaction that removes the document
and, unless the registration was already cancelled, gives the seat back (`registeredCount` −1), then writes
an `auditLogs` entry. The page then shows a short "Registration deleted" confirmation.

## Status pipeline

```
 visitor registers
        │
        ▼
 ┌─────────────┐  Confirm   ┌───────────┐  Check in  ┌───────────┐  Board bus N  ┌────────────┐
 │Pending review│ ─────────► │ Confirmed │ ─────────► │ At pickup │ ────────────► │ On the bus │
 └─────────────┘ (Reg team)  └───────────┘ (Crowd)    └───────────┘   (Crowd)      └────────────┘
        │                      │    ▲  ▲                   │
        │                      │    │  └──── Undo ─────────┘
        │                      ▼    │
        │                  ┌─────────┐
        │                  │ No-show │ (Undo → Confirmed)
        │                  └─────────┘
        ▼
   Cancelled  ← Registration team, from any status except On the bus (seat is released)
```

| Status       | Label          | Badge          |
|--------------|----------------|----------------|
| `pending`    | Pending review | grey           |
| `confirmed`  | Confirmed      | dusk blue      |
| `checked_in` | At pickup      | sun amber      |
| `boarded`    | On the bus     | palm green     |
| `no_show`    | No-show        | light clay     |
| `cancelled`  | Cancelled      | solid clay     |

**Hand-off between teams:** confirming a visitor moves them onto the Crowd team's pickup list. The Crowd team never
sees pending or cancelled visitors, only a count of how many are still pending. When the Crowd team uses
**Flag issue**, the registration is highlighted and sorted to the top of the Registration list with the message
until someone presses **Mark resolved**.

## Data model (Firestore)

| Collection            | Fields                                                                                                     |
|-----------------------|------------------------------------------------------------------------------------------------------------|
| `tours/{id}`          | name, slot (`morning`/`evening`), pickupPoint, departureTime (`"08:00"`), date (`"YYYY-MM-DD"` or `""`), capacity, registeredCount, active, order, restrictedNationalities (ISO alpha-2 codes that may not join; `[]` for none), experienceDuration (`""` for none), notices (`[]` for none) |
| `registrations/{CODE}`| The 6-character code is the doc ID. name, email (lowercase), phone (E.164), phoneCountry (ISO2), idType (`national_id`/`passport`), idNumber, nationality (ISO alpha-2), tourId, tourName, slot, tourDate (`"YYYY-MM-DD"`), departureTime, status, busNumber, flag, conditionsAcceptedAt, mailId, createdAt, updatedAt, updatedBy, checkedInAt, boardedAt |
| `admins/{uid}`        | email, name, role (`po`/`pm`/`registration`/`crowd`)                                                       |
| `auditLogs/{id}`      | action, regId, detail, byUid, byEmail, byRole, at. Append-only; PO/PM can read.                          |
| `mail/{id}`           | Trigger Email extension format (`to`, optional `from`, `message.subject/text/html`). Written by the server only; PO/PM/Registration may read it so the UI can show `delivery.state`. |

Registrations are created **only** by `POST /api/register` (Admin SDK) inside a transaction that checks the
tour is open, that the visitor's nationality isn't restricted, that the date matches the tour's fixed date,
that there are seats left, and that the passport isn't already registered for that tour on that date. It then
creates the registration and increments `registeredCount` atomically, so the public can't overbook or write
to the database directly.

Deleting is the Product Owner's alone, in the UI (`can(role, 'deleteRegistrations')`) and in
`firestore.rules` (`allow delete: if hasRole(['po'])`). `deleteRegistration()` runs a client transaction that
removes the document and, unless it was already cancelled, decrements `registeredCount`, then writes an
`auditLogs` entry (`registration:delete`) naming the visitor, passport, tour and date.

## Project layout

```
app/
  page.tsx                  public registration form
  registered/[code]/        confirmation page (server component, Admin SDK)
  login/                    staff sign-in
  admin/                    layout (auth + role guard), overview, registrations, crowd, tours, team
  api/register/             public registration endpoint
  api/admins/               PO-only: create team member
lib/
  firebase.ts               client SDK (env only)
  firebase-admin.ts         Admin SDK (server-only, lazy init)
  roles.ts                  permission matrix + can()
  actions.ts                setStatus, cancelRegistration, setFlag, tours/team actions (+ audit log)
  hooks.ts                  useTours, useRegistrations, useTourRegistrations, useAdmins (onSnapshot)
  validation.ts             shared client/server form validation
  nationalities.ts          ISO 3166-1 alpha-2 + demonym, Saudi pinned first
  countries.ts              flag + name + dial code, derived from libphonenumber metadata
  phone.ts                  parse/validate/format on libphonenumber-js/min
  saudi-id.ts               National ID check digit
  mail.ts                   the booking confirmation (text + HTML)
  mail-status.ts            live delivery state from mail/{id}.delivery
  format.ts                 date/dash helpers shared by server, client and scripts
  trips.ts                  destination + date + departure time grouping, and the counts
  excel.ts                  .xlsx export (exceljs, loaded on demand)
components/
  ui.tsx                    status badge, sun/moon marks, date helpers
  Logos.tsx                 the three partner logos + the public page band
  ConfirmDialog.tsx         accessible modal (focus trap, Escape, focus return)
  Combobox.tsx              the shared type-to-search picker
  PhoneField.tsx            country dial code + national number
  TourNotices.tsx           "Before you book" panel and its inline admin variant
  NationalitySelect.tsx     searchable nationality combobox
public/logos/               logo1 WPC Energy, logo2 Congress, logo3 Ministry of Energy
scripts/seed.mjs            tours + first PO
scripts/migrate.mjs         tour restrictions + Boulevard City info + passport → idType/idNumber
firestore.rules, firestore.indexes.json, firebase.json, .firebaserc
```

## Production checklist

- [ ] **Bot protection on `/api/register`:** add Firebase App Check (reCAPTCHA Enterprise) and verify the token in the
      route with `getAppCheck().verifyToken()`, or add reCAPTCHA/Turnstile. Consider rate limiting by IP (e.g. Vercel KV / Upstash).
- [ ] **Deploy:** use Vercel (import the repo) or Firebase App Hosting (`npx firebase-tools apphosting:backends:create`).
- [ ] **Environment variables:** add every key from `.env.example` in the hosting dashboard. Store `FIREBASE_PRIVATE_KEY`
      as a secret (App Hosting: `apphosting.yaml` + Cloud Secret Manager).
- [ ] **Authorized domains:** add the production domain under Authentication → Settings → Authorized domains.
- [ ] **Confirmation emails:** install the **Trigger Email from Firestore** extension — see
      [Confirmation emails](#confirmation-emails). Until then the documents queue up and nothing is sent.
- [ ] **Rules:** run `npx firebase-tools deploy --only firestore` again after any change to `firestore.rules`.
- [ ] **Backups:** enable Firestore point-in-time recovery or scheduled exports.
- [ ] **Accounts:** ask every team member to change their temporary password (via "forgot password" or the Firebase console).
- [ ] **Next.js:** this project is pinned to Next 14 as specified. 14.2.35 is the final 14.x release, and some advisories
      are only fixed in Next 15+, so plan an upgrade.
