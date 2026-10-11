import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

export type Role = 'po' | 'pm' | 'registration' | 'crowd';

/** Emails for every registration the suite creates, so teardown can find them. */
export const TEST_EMAIL_PREFIX = 'e2e+';
export const TEST_EMAIL_DOMAIN = '@tour.test';
export const testEmail = () =>
  `${TEST_EMAIL_PREFIX}${Date.now()}${randomInt(1000, 9999)}${TEST_EMAIL_DOMAIN}`;
export const isTestEmail = (e: string) =>
  e.startsWith(TEST_EMAIL_PREFIX) && e.endsWith(TEST_EMAIL_DOMAIN);

/** Every passport the suite invents starts with E2E, which real passports never do. */
export const TEST_PASSPORT_PREFIX = 'E2E';
export const testPassport = () =>
  `${TEST_PASSPORT_PREFIX}${String(Date.now()).slice(-8)}${randomInt(100, 999)}`;
export const isTestPassport = (p: string) => p.startsWith(TEST_PASSPORT_PREFIX);

/**
 * A National ID has a check digit, so it can't carry a marker the way a passport can.
 * Saudi test registrations are recognised by their e2e email instead, which is now a
 * required field on every registration.
 */
export function nationalIdCheckDigit(firstNine: string) {
  let total = 0;
  for (let i = 0; i < 9; i++) {
    const d = Number(firstNine[i]);
    if (i % 2 === 0) { const x = d * 2; total += x > 9 ? x - 9 : x; } else total += d;
  }
  return (10 - (total % 10)) % 10;
}
/** A fresh, genuinely valid National ID. */
export function testNationalId() {
  const stem = `1${String(randomInt(0, 99999999)).padStart(8, '0')}`;
  return `${stem}${nationalIdCheckDigit(stem)}`;
}

/** True for anything this suite created, however it was created. */
export const isTestReg = (d: { email?: unknown; idNumber?: unknown; passportNumber?: unknown }) =>
  isTestEmail(String(d.email ?? ''))
  || isTestPassport(String(d.idNumber ?? ''))
  || isTestPassport(String(d.passportNumber ?? ''));

/** "YYYY-MM-DD" in Riyadh, the same clock lib/validation.ts uses. */
export const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

/** A date `days` after today, as "YYYY-MM-DD". */
export function dayAfter(days: number) {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- Admin SDK

let app: App | undefined;
export function adminApp(): App {
  if (app) return app;
  app = getApps()[0] ?? initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    }),
  });
  return app;
}
export const adminDb = (): Firestore => getFirestore(adminApp());

// ---------------------------------------------------------------- credentials

export interface Creds { email: string; password: string }

/**
 * Reads the table in test-accounts.local.md written by `npm run test-admins`.
 * Roles are resolved by the Role column, so the staff emails can change without
 * touching the suite.
 */
export function readCreds(): Record<Role, Creds> {
  let md: string;
  try {
    md = readFileSync('test-accounts.local.md', 'utf8');
  } catch {
    throw new Error('test-accounts.local.md is missing. Run `npm run test-admins` first.');
  }

  const LABEL_TO_ROLE: Record<string, Role> = {
    'product owner': 'po',
    'project manager': 'pm',
    registration: 'registration',
    crowd: 'crowd',
  };

  const found = {} as Record<Role, Creds>;
  for (const line of md.split('\n')) {
    // | Product Owner | someone@example.com | `password` |
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(\S+@\S+)\s*\|\s*`([^`]+)`\s*\|/);
    if (!m) continue;
    const role = LABEL_TO_ROLE[m[1].trim().toLowerCase()];
    if (role) found[role] = { email: m[2].trim(), password: m[3] };
  }

  const missing = (['po', 'pm', 'registration', 'crowd'] as Role[]).filter((r) => !found[r]);
  if (missing.length) {
    throw new Error(
      `test-accounts.local.md has no row for: ${missing.join(', ')}. Re-run \`npm run test-admins\`.`
    );
  }
  return found;
}

let _creds: Record<Role, Creds> | undefined;
/** Lazy so global-setup can run before the credentials file is needed. */
export const CREDS = new Proxy({} as Record<Role, Creds>, {
  get(_t, prop: string) {
    _creds ??= readCreds();
    return _creds[prop as Role];
  },
});

// ---------------------------------------------------------------- UI helpers

export async function signIn(page: Page, role: Role) {
  const { email, password } = CREDS[role];
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The layout header proves both auth and the role doc resolved.
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

export interface VisitorOpts {
  name: string;
  tourId: string;
  /** Required on the form; defaults to a fresh e2e address. */
  email?: string;
  /** National part only, e.g. "0501234567". */
  phone?: string;
  /** ISO2 of the dial code to pick. Left alone to test the nationality default. */
  phoneCountry?: string;
  /** National ID or passport — defaults to whatever the nationality calls for. */
  idNumber?: string;
  /** Demonym, not the code, because that is what the combobox shows. */
  nationality?: string;
  /** Ignored when the tour has a fixed date — the form fills that in itself. */
  date?: string;
  /** Leave false to prove the consent checkbox is enforced. */
  acceptConditions?: boolean;
}

// ---------------------------------------------------------------- form fields

/** The country-code combobox next to the mobile number. */
export const countryBox = (page: Page) => page.getByRole('combobox', { name: 'Country code' });

/** Picks a dial code by ISO2, e.g. "GB". */
export async function chooseCountryCode(page: Page, iso2: string) {
  const input = countryBox(page);
  await input.click();
  await input.fill('');
  await page.locator(`[role="option"][data-value="${iso2}"]`).first().click();
}

/** The identity field, whose label follows the nationality. */
export const idBox = (page: Page) => page.locator('#idNumber');

// ---------------------------------------------------------------- logos

/** Left to right, exactly as components/Logos.tsx renders them. */
export const LOGO_ALTS = [
  'WPC Energy',
  '25th WPC Energy Congress, 11–15 October 2026',
  'Ministry of Energy',
] as const;

/** Checks all three logos are present, in order, the same height, and on screen. */
export async function expectLogos(page: Page, scope = page.locator('body')) {
  const boxes: { h: number; x: number; right: number }[] = [];
  for (const alt of LOGO_ALTS) {
    const img = scope.getByAltText(alt, { exact: true });
    await expect(img, `logo "${alt}" is missing`).toBeVisible();
    const b = (await img.boundingBox())!;
    expect(b.width, `logo "${alt}" has no width`).toBeGreaterThan(0);
    boxes.push({ h: b.height, x: b.x, right: b.x + b.width });
  }
  // Same visible height, within a rounding pixel or two.
  const heights = boxes.map((b) => b.h);
  expect(Math.max(...heights) - Math.min(...heights),
    `logo heights differ: ${heights.join(', ')}`).toBeLessThanOrEqual(2);
  // Left to right in the agreed order, with no overlap.
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].x, `logo ${i + 1} is not to the right of logo ${i}`)
      .toBeGreaterThanOrEqual(boxes[i - 1].right - 1);
  }
  return boxes;
}

export async function noSidewaysScroll(page: Page) {
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(scrollW, 'page scrolls sideways').toBeLessThanOrEqual(clientW);
}

/** The nationality combobox. Addressed by role so the popup listbox can't be confused for it. */
export const nationalityBox = (page: Page) => page.getByRole('combobox', { name: 'Nationality' });

/** Picks a nationality through the combobox, exactly as a visitor would. */
export async function chooseNationality(page: Page, label: string) {
  const input = nationalityBox(page);
  await input.click();
  await input.fill(label);
  await page.getByRole('option', { name: label, exact: true }).first().click();
  await expect(input).toHaveValue(label);
}

/** Registers a visitor through the public form and returns the 6-char code. */
export async function registerVisitor(page: Page, opts: VisitorOpts) {
  await fillRegistrationForm(page, opts);
  await page.getByRole('button', { name: /Register for this tour/ }).click();
  await expect(page).toHaveURL(/\/registered\/[A-Z2-9]{6}/, { timeout: 30_000 });
  return page.url().split('/').pop()!.toUpperCase();
}

/** Everything registerVisitor does except pressing Register — for validation tests. */
export async function fillRegistrationForm(page: Page, opts: VisitorOpts) {
  await page.goto('/');
  await page.getByLabel('Full name').fill(opts.name);

  // Nationality first: it decides whether the ID field wants an ID or a passport, and
  // suggests the dial code.
  const nationality = opts.nationality ?? 'Saudi';
  await chooseNationality(page, nationality);
  // Pin the dial code explicitly: the nationality would otherwise move it, and the
  // default number below is a Saudi one. (phone.spec.ts covers the suggestion itself.)
  await chooseCountryCode(page, opts.phoneCountry ?? 'SA');
  await page.getByLabel('Mobile number').fill(opts.phone ?? '0501234567');

  const isSaudi = nationality === 'Saudi';
  await idBox(page).fill(opts.idNumber ?? (isSaudi ? testNationalId() : testPassport()));

  // The radio itself is .sr-only, so click the label that wraps it, as a user would.
  const radio = page.locator(`input[name="tour"][value="${opts.tourId}"]`);
  await page.locator('label', { has: radio }).click();
  await expect(radio).toBeChecked();

  const date = page.getByLabel('Date', { exact: true });
  if (!(await date.evaluate((el: HTMLInputElement) => el.readOnly))) {
    await date.fill(opts.date ?? dayAfter(1));
  }
  await page.getByLabel('Email', { exact: true }).fill(opts.email ?? testEmail());

  // Only tours that carry notices show the checkbox.
  const consent = page.locator('#acceptedConditions');
  if (opts.acceptConditions !== false && await consent.count()) await consent.check();
}

/** The JSON body /api/register expects, with sensible defaults. */
export function registrationBody(over: Record<string, unknown> = {}) {
  return {
    name: 'Api Visitor', phone: '0501234567', phoneCountry: 'SA',
    idNumber: testNationalId(), nationality: 'SA',
    tourId: TOUR_IDS.aramco, tourDate: dayAfter(1),
    email: testEmail(), acceptedConditions: true,
    ...over,
  };
}

// ---------------------------------------------------------------- data helpers

export const TOUR_IDS = {
  kapsarc: 'kapsarc-black-gold',
  sabic: 'sabic-home-of-innovation',
  sabicB2: 'sabic-home-of-innovation-b2',
  aramco: 'aramco-kafd',
  aramcoB2: 'aramco-kafd-b2',
  diriyah: 'diriyah-heritage-trail',
  downtown: 'downtown-national-history',
} as const;

/** The agreed batch schedule, mirroring scripts/migrate-batches.mjs. */
export const BATCHES = {
  sabic: [
    { id: TOUR_IDS.sabic, batch: 1, departureTime: '08:00', capacity: 20 },
    { id: TOUR_IDS.sabicB2, batch: 2, departureTime: '09:00', capacity: 20 },
  ],
  aramco: [
    { id: TOUR_IDS.aramco, batch: 1, departureTime: '09:00', capacity: 10 },
    { id: TOUR_IDS.aramcoB2, batch: 2, departureTime: '10:00', capacity: 10 },
  ],
} as const;

/**
 * Seats a batch without creating registrations, so a "Full" case costs one write
 * instead of twenty. Returns the previous count so the test can put it back.
 */
export async function fillSeats(tourId: string, taken?: number) {
  const t = await getTour(tourId);
  const before = t.registeredCount;
  await patchTour(tourId, { registeredCount: taken ?? t.capacity });
  return before;
}

/**
 * Boulevard City was created through the admin UI, so its document id is generated
 * rather than a slug. It is looked up by name once per run.
 */
let boulevardId: string | undefined;
export async function boulevardTourId() {
  if (boulevardId) return boulevardId;
  const snap = await adminDb().collection('tours').where('name', '==', 'Boulevard City').limit(1).get();
  if (snap.empty) throw new Error('No "Boulevard City" tour. Run `npm run migrate`.');
  boulevardId = snap.docs[0].id;
  return boulevardId;
}

export const BOULEVARD_DURATION = '15–20 minutes from entering the experience venue';
export const BOULEVARD_NOTICES = [
  'Photography is strictly prohibited inside the experience.',
  'Pregnant women are not allowed to participate.',
  'Visitors with heart conditions or high blood pressure are not allowed to participate.',
  'Visitors who have recently undergone surgery are not allowed to participate.',
];

export async function getTour(tourId: string) {
  const snap = await adminDb().collection('tours').doc(tourId).get();
  return snap.data() as {
    name: string; slot: string; pickupPoint: string; departureTime: string;
    date?: string; capacity: number; registeredCount: number; active: boolean; order: number;
    restrictedNationalities?: string[]; experienceDuration?: string; notices?: string[];
    destinationId?: string; batch?: number | null;
  };
}

export const patchTour = (tourId: string, patch: Record<string, unknown>) =>
  adminDb().collection('tours').doc(tourId).update(patch);

/** Fills a tour so the public form shows it as Full: capacity = registeredCount. */
export async function fillTour(tourId: string) {
  const t = await getTour(tourId);
  await patchTour(tourId, { capacity: Math.max(1, t.registeredCount) });
}

export const getReg = async (code: string) =>
  (await adminDb().collection('registrations').doc(code).get()).data() as
    | {
        status: string; busNumber?: string | null; flag?: string | null;
        email?: string | null; name: string; phone: string; phoneCountry?: string;
        idType?: 'national_id' | 'passport'; idNumber?: string;
        nationality?: string; tourDate?: string; departureTime?: string; batch?: number | null;
        conditionsAcceptedAt?: unknown; mailId?: string | null;
      }
    | undefined;

// ---------------------------------------------------------------- mail

export interface MailDoc {
  id: string;
  to: string;
  from?: string;
  message: { subject: string; text: string; html: string };
}

/** The booking confirmation queued for a registration, via its stored mailId. */
export async function mailFor(code: string): Promise<MailDoc | undefined> {
  const reg = await getReg(code);
  if (!reg?.mailId) return undefined;
  const snap = await adminDb().collection('mail').doc(reg.mailId).get();
  if (!snap.exists) return undefined;
  return { id: snap.id, ...(snap.data() as Omit<MailDoc, 'id'>) };
}

/** Every mail document addressed to one visitor — used to prove there is exactly one. */
export async function mailsTo(email: string) {
  const snap = await adminDb().collection('mail').where('to', '==', email).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MailDoc, 'id'>) }));
}

/** Audit entries for one registration, newest first. */
export async function auditFor(regId: string) {
  const snap = await adminDb().collection('auditLogs').where('regId', '==', regId).get();
  return snap.docs.map((d) => d.data() as {
    action: string; regId: string | null; detail: string | null;
    byUid: string; byEmail: string; byRole: Role;
  });
}

export async function waitForAudit(regId: string, action: string, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const entries = await auditFor(regId);
    const hit = entries.find((e) => e.action === action);
    if (hit) return hit;
    if (Date.now() > until) {
      throw new Error(`No auditLogs entry "${action}" for ${regId}. Saw: ${entries.map((e) => e.action).join(', ') || '(none)'}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** The admins/{uid} doc for a role, looked up by the email in test-accounts.local.md. */
export async function adminDocFor(role: Role) {
  const email = CREDS[role].email;
  const snap = await adminDb().collection('admins').where('email', '==', email).get();
  if (snap.empty) throw new Error(`No admins doc for ${email}. Run \`npm run test-admins\`.`);
  const d = snap.docs[0];
  return { uid: d.id, ...(d.data() as { email: string; name: string; role: Role }) };
}
