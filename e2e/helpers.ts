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

/** Registers a visitor through the public form and returns the 6-char code. */
export async function registerVisitor(
  page: Page, opts: { name: string; email: string; phone?: string; tourId: string }
) {
  await page.goto('/');
  // The radio itself is .sr-only, so click the label that wraps it, as a user would.
  const radio = page.locator(`input[name="tour"][value="${opts.tourId}"]`);
  await page.locator('label', { has: radio }).click();
  await expect(radio).toBeChecked();
  await page.getByLabel('Full name').fill(opts.name);
  await page.getByLabel('Email').fill(opts.email);
  await page.getByLabel('Phone number').fill(opts.phone ?? '0501234567');
  await page.getByRole('button', { name: /Register for this tour/ }).click();
  await expect(page).toHaveURL(/\/registered\/[A-Z2-9]{6}/, { timeout: 30_000 });
  return page.url().split('/').pop()!.toUpperCase();
}

// ---------------------------------------------------------------- data helpers

export const TOUR_IDS = {
  kapsarc: 'kapsarc-black-gold',
  sabic: 'sabic-home-of-innovation',
  aramco: 'aramco-kafd',
  diriyah: 'diriyah-heritage-trail',
  downtown: 'downtown-national-history',
} as const;

export async function getTour(tourId: string) {
  const snap = await adminDb().collection('tours').doc(tourId).get();
  return snap.data() as {
    name: string; slot: string; pickupPoint: string; departureTime: string;
    date?: string; capacity: number; registeredCount: number; active: boolean; order: number;
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
    | { status: string; busNumber?: string | null; flag?: string | null; email: string; name: string }
    | undefined;

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
