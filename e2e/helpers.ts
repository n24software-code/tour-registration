import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

// ---------------------------------------------------------------- Supabase

let admin: SupabaseClient | undefined;
/** The secret-key client: bypasses RLS, for setting up and tearing down test data. */
export function adminDb(): SupabaseClient {
  admin ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return admin;
}

/** A client signed in as one of the team roles, for the RLS tests. */
export async function clientAs(role: Role) {
  const { email, password } = CREDS[role];
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign in as ${role}: ${error.message}`);
  return supabase;
}

/** An anonymous client — the publishable key with no session. */
export const anonClient = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

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
  sabic: 'sabic-b1',
  sabicB2: 'sabic-b2',
  aramco: 'aramco-b1',
  aramcoB2: 'aramco-b2',
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

/** Looked up by name once per run, so a change of id doesn't break the specs. */
let boulevardId: string | undefined;
export async function boulevardTourId() {
  if (boulevardId) return boulevardId;
  const { data } = await adminDb()
    .from('tours').select('id').eq('name', 'Boulevard City').limit(1).maybeSingle();
  if (!data) throw new Error('No "Boulevard City" tour. Run `npm run seed`.');
  boulevardId = (data as { id: string }).id;
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
  const { data } = await adminDb().from('tours').select('*').eq('id', tourId).maybeSingle();
  if (!data) throw new Error(`No tour "${tourId}".`);
  const r = data as Record<string, unknown>;
  return {
    name: r.name as string,
    slot: r.slot as string,
    pickupPoint: r.pickup_point as string,
    departureTime: String(r.departure_time ?? '').slice(0, 5),
    date: (r.tour_date as string | null) ?? '',
    capacity: r.capacity as number,
    registeredCount: r.registered_count as number,
    active: r.active as boolean,
    order: r.sort_order as number,
    restrictedNationalities: (r.restricted_nationalities as string[]) ?? [],
    experienceDuration: (r.experience_duration as string | null) ?? '',
    notices: (r.notices as string[]) ?? [],
    destinationId: r.destination_id as string,
    batch: (r.batch as number | null) ?? null,
  };
}

/** The specs patch tours in camelCase; these are the real column names. */
const TOUR_COLUMNS: Record<string, string> = {
  registeredCount: 'registered_count',
  departureTime: 'departure_time',
  pickupPoint: 'pickup_point',
  date: 'tour_date',
  order: 'sort_order',
  restrictedNationalities: 'restricted_nationalities',
  experienceDuration: 'experience_duration',
  destinationId: 'destination_id',
};

export async function patchTour(tourId: string, patch: Record<string, unknown>) {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = TOUR_COLUMNS[k] ?? k;
    row[col] = col === 'tour_date' && v === '' ? null : v;
  }
  const { error } = await adminDb().from('tours').update(row).eq('id', tourId);
  if (error) throw new Error(`patchTour(${tourId}): ${error.message}`);
}

/** Fills a tour so the public form shows it as Full: capacity = registeredCount. */
export async function fillTour(tourId: string) {
  const t = await getTour(tourId);
  await patchTour(tourId, { capacity: Math.max(1, t.registeredCount) });
}

export interface RegShape {
  status: string;
  busNumber?: string | null;
  flag?: string | null;
  email?: string | null;
  name: string;
  phone: string;
  phoneCountry?: string;
  idType?: 'national_id' | 'passport';
  idNumber?: string;
  nationality?: string;
  tourId?: string;
  tourDate?: string;
  departureTime?: string;
  batch?: number | null;
  conditionsAcceptedAt?: unknown;
}

export async function getReg(code: string): Promise<RegShape | undefined> {
  const { data } = await adminDb()
    .from('registrations').select('*').eq('code', code).maybeSingle();
  if (!data) return undefined;
  const r = data as Record<string, unknown>;
  return {
    status: r.status as string,
    busNumber: (r.bus_number as string | null) ?? null,
    flag: (r.flag as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    name: r.name as string,
    phone: r.phone as string,
    phoneCountry: r.phone_country as string,
    idType: r.id_type as 'national_id' | 'passport',
    idNumber: r.id_number as string,
    nationality: r.nationality as string,
    tourId: r.tour_id as string,
    tourDate: (r.tour_date as string | null) ?? '',
    departureTime: String(r.departure_time ?? '').slice(0, 5),
    batch: (r.batch as number | null) ?? null,
    conditionsAcceptedAt: r.conditions_accepted_at,
  };
}

// ---------------------------------------------------------------- outbox

export interface OutboxShape {
  id: string;
  regCode: string | null;
  to: string;
  subject: string | null;
  text: string | null;
  html: string | null;
  status: 'pending' | 'sent' | 'error';
  attempts: number;
  error: string | null;
}

const toOutbox = (r: Record<string, unknown>): OutboxShape => ({
  id: r.id as string,
  regCode: (r.reg_code as string | null) ?? null,
  to: r.to_email as string,
  subject: (r.subject as string | null) ?? null,
  text: (r.text as string | null) ?? null,
  html: (r.html as string | null) ?? null,
  status: r.status as OutboxShape['status'],
  attempts: r.attempts as number,
  error: (r.error as string | null) ?? null,
});

/** Every outbox row for a registration, oldest first. */
export async function outboxFor(code: string): Promise<OutboxShape[]> {
  const { data } = await adminDb()
    .from('email_outbox').select('*').eq('reg_code', code)
    .order('created_at', { ascending: true });
  return (data ?? []).map((r) => toOutbox(r as Record<string, unknown>));
}

/** The newest outbox row for a registration. */
export async function mailFor(code: string): Promise<OutboxShape | undefined> {
  const rows = await outboxFor(code);
  return rows[rows.length - 1];
}

export async function mailsTo(email: string): Promise<OutboxShape[]> {
  const { data } = await adminDb()
    .from('email_outbox').select('*').eq('to_email', email)
    .order('created_at', { ascending: true });
  return (data ?? []).map((r) => toOutbox(r as Record<string, unknown>));
}

/** Audit entries for one registration, newest first. */
export async function auditFor(regId: string) {
  const { data } = await adminDb()
    .from('audit_logs').select('*').eq('reg_code', regId)
    .order('at', { ascending: false });
  return (data ?? []).map((d) => {
    const r = d as Record<string, unknown>;
    return {
      action: r.action as string,
      regId: (r.reg_code as string | null) ?? null,
      detail: (r.detail as string | null) ?? null,
      byUid: (r.by_uid as string | null) ?? '',
      byEmail: (r.by_email as string | null) ?? '',
      byRole: r.by_role as Role,
    };
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
  const { data } = await adminDb()
    .from('admins').select('*').eq('email', email).maybeSingle();
  if (!data) throw new Error(`No admins row for ${email}. Run \`npm run create-admins\`.`);
  const r = data as Record<string, unknown>;
  return {
    uid: r.user_id as string,
    email: r.email as string,
    name: r.name as string,
    role: r.role as Role,
  };
}
