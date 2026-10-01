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
6. **Run:** `npm run dev`. Visitors use `/`, and staff sign in at `/login`. The PO adds the rest of the team under **Team**.

Edit pickup points, dates, times and capacity on the **Tours** page after seeding.

## Roles and permissions

Roles are stored in `admins/{uid}` as `{ email, name, role }`. The UI matrix lives in `lib/roles.ts` (`can(role, permission)`),
and `firestore.rules` enforces the same rules on the server.

| Permission            | What it allows                                         | PO | PM | Registration | Crowd |
|-----------------------|--------------------------------------------------------|----|----|--------------|-------|
| `viewOverview`        | Overview dashboard                                     | ✓  | ✓  | ✓            | ✓     |
| `manageRegistrations` | Confirm, cancel, search, export CSV, resolve flags     | ✓  | ✓  | ✓            |       |
| `operatePickup`       | Check in, board bus, no-show, undo, flag issue         | ✓  | ✓  |              | ✓     |
| `manageTours`         | Edit/add tours, capacity, open/close registration      | ✓  | ✓  |              |       |
| `manageTeam`          | Add members, change roles, remove access               | ✓  |    |              |       |

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
| `tours/{id}`          | name, slot (`morning`/`evening`), pickupPoint, departureTime (`"08:00"`), date (`"YYYY-MM-DD"` or `""`), capacity, registeredCount, active, order |
| `registrations/{CODE}`| The 6-character code is the doc ID. name, email (lowercase), phone, tourId, tourName, slot, status, busNumber, flag, createdAt, updatedAt, updatedBy, checkedInAt, boardedAt |
| `admins/{uid}`        | email, name, role (`po`/`pm`/`registration`/`crowd`)                                                       |
| `auditLogs/{id}`      | action, regId, detail, byUid, byEmail, byRole, at. Append-only; PO/PM can read.                          |
| `mail/{id}`           | Trigger Email extension format (`to`, `message.subject`, `message.text`). Server-only.                    |

Registrations are created **only** by `POST /api/register` (Admin SDK) inside a transaction that checks the tour
is open, has seats left, and that the email isn't already registered for that tour. It then creates the
registration and increments `registeredCount` atomically, so the public can't overbook or write to the
database directly.

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
scripts/seed.mjs            tours + first PO
firestore.rules, firestore.indexes.json, firebase.json, .firebaserc
```

## Production checklist

- [ ] **Bot protection on `/api/register`:** add Firebase App Check (reCAPTCHA Enterprise) and verify the token in the
      route with `getAppCheck().verifyToken()`, or add reCAPTCHA/Turnstile. Consider rate limiting by IP (e.g. Vercel KV / Upstash).
- [ ] **Deploy:** use Vercel (import the repo) or Firebase App Hosting (`npx firebase-tools apphosting:backends:create`).
- [ ] **Environment variables:** add every key from `.env.example` in the hosting dashboard. Store `FIREBASE_PRIVATE_KEY`
      as a secret (App Hosting: `apphosting.yaml` + Cloud Secret Manager).
- [ ] **Authorized domains:** add the production domain under Authentication → Settings → Authorized domains.
- [ ] **Confirmation emails:** install the **Trigger Email from Firestore** extension (collection `mail`), configure SMTP,
      then set `ENABLE_CONFIRMATION_EMAIL=true`.
- [ ] **Rules:** run `npx firebase-tools deploy --only firestore` again after any change to `firestore.rules`.
- [ ] **Backups:** enable Firestore point-in-time recovery or scheduled exports.
- [ ] **Accounts:** ask every team member to change their temporary password (via "forgot password" or the Firebase console).
- [ ] **Next.js:** this project is pinned to Next 14 as specified. 14.2.35 is the final 14.x release, and some advisories
      are only fixed in Next 15+, so plan an upgrade.
