// Creates (or reuses) the staff logins listed in admins.local.json and writes
// admins/{uid} = { email, name, role }. Credentials go to test-accounts.local.md.
// Both of those files are git-ignored. Passwords are never printed.
// Usage: npm run test-admins
import { randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config({ path: '.env.local' });
dotenv.config(); // fall back to .env

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY
  || FIREBASE_CLIENT_EMAIL === 'REPLACE_ME' || FIREBASE_PRIVATE_KEY === 'REPLACE_ME') {
  console.error('Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env.local first.');
  process.exit(1);
}

// ---------------------------------------------------------------- input file

const ACCOUNTS_FILE = process.argv[2] ?? 'admins.local.json';
if (!existsSync(ACCOUNTS_FILE)) {
  console.error(`Missing ${ACCOUNTS_FILE}. Create it (git-ignored) in this shape:

{
  "admins": [
    { "email": "owner@example.com", "name": "Owner Name", "role": "po", "password": "optional" }
  ]
}

An entry without "password" gets a random 14-character one.`);
  process.exit(1);
}

const ROLES = ['po', 'pm', 'registration', 'crowd'];

let accounts;
try {
  const parsed = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'));
  accounts = Array.isArray(parsed) ? parsed : parsed.admins;
} catch {
  console.error(`${ACCOUNTS_FILE} is not valid JSON.`);
  process.exit(1);
}
if (!Array.isArray(accounts) || accounts.length === 0) {
  console.error(`${ACCOUNTS_FILE} has no "admins" array.`);
  process.exit(1);
}

// Validate before touching Auth, so a typo can't half-apply.
const problems = [];
accounts.forEach((a, i) => {
  const where = `admins[${i}]`;
  if (!a || typeof a !== 'object') return problems.push(`${where} is not an object`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(a.email ?? ''))) problems.push(`${where}: invalid email`);
  if (String(a.name ?? '').trim().length < 2) problems.push(`${where}: name is too short`);
  if (!ROLES.includes(a.role)) problems.push(`${where}: role must be one of ${ROLES.join(', ')}`);
  if (a.password !== undefined && String(a.password).length < 8) problems.push(`${where}: password must be at least 8 characters`);
});
const emails = accounts.map((a) => String(a.email ?? '').trim().toLowerCase());
emails.forEach((e, i) => { if (emails.indexOf(e) !== i) problems.push(`duplicate email ${e}`); });
if (problems.length) {
  console.error(`${ACCOUNTS_FILE} has problems:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------- firebase

initializeApp({
  credential: cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});
const db = getFirestore();
const auth = getAuth();

// 14 characters, drawn uniformly with crypto.randomInt.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
const newPassword = () => Array.from({ length: 14 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const rows = [];
for (const entry of accounts) {
  const email = String(entry.email).trim().toLowerCase();
  const name = String(entry.name).trim();
  const role = entry.role;
  const password = entry.password ? String(entry.password) : newPassword();
  const generated = !entry.password;

  let user;
  try {
    user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password, displayName: name });
    console.log(`reset    ${email.padEnd(28)} ${role.padEnd(13)} existing login, password set`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    user = await auth.createUser({ email, password, displayName: name });
    console.log(`created  ${email.padEnd(28)} ${role.padEnd(13)} new login`);
  }

  await db.collection('admins').doc(user.uid).set({ email, name, role });
  rows.push({ role, email, name, password, generated });
}

// ---------------------------------------------------------------- credentials file

const ORDER = ['po', 'pm', 'registration', 'crowd'];
const LABEL = { po: 'Product Owner', pm: 'Project Manager', registration: 'Registration', crowd: 'Crowd' };
const file = [
  '# Staff logins (local only - do not commit)',
  '',
  `Generated ${new Date().toISOString()} by \`npm run test-admins\` from \`${ACCOUNTS_FILE}\`.`,
  'The e2e suite reads this file. Change the shared passwords after testing,',
  'and remove the throwaway @tour.test accounts before launch.',
  '',
  '| Role | Email | Password |',
  '| --- | --- | --- |',
  ...rows
    .slice()
    .sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role))
    .map((r) => `| ${LABEL[r.role]} | ${r.email} | \`${r.password}\` |`),
  '',
  'Generated (random) passwords: ' + (rows.filter((r) => r.generated).map((r) => r.email).join(', ') || 'none'),
  '',
].join('\n');

writeFileSync('test-accounts.local.md', file);
console.log(`\n${rows.length} accounts ready. Credentials written to test-accounts.local.md (git-ignored).`);
console.log('Passwords were not printed.');
