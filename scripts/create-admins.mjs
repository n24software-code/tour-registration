// Creates (or reuses) the Supabase Auth login for every entry in admins.local.json and
// gives it a role. Idempotent: safe to re-run.
//
//   npm run create-admins
//
// Passwords come from the file. An entry with no password gets a generated one, which
// is written to test-accounts.local.md (git-ignored) and never printed here.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const { NEXT_PUBLIC_SUPABASE_URL: URL, SUPABASE_SECRET_KEY: KEY } = process.env;
if (!URL || !KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.');
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

let file;
try {
  file = JSON.parse(readFileSync('admins.local.json', 'utf8'));
} catch {
  console.error('admins.local.json is missing or unreadable.');
  process.exit(1);
}
const wanted = file.admins ?? file;
const ROLES = new Set(['po', 'pm', 'registration', 'crowd']);

/** Readable but strong; only ever written to the git-ignored notes file. */
const makePassword = () => `${randomBytes(9).toString('base64url')}Aa1!`;

/** listUsers is paginated; find by email across pages. */
async function findUser(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

const rows = [];
for (const entry of wanted) {
  const email = String(entry.email ?? '').trim().toLowerCase();
  const name = String(entry.name ?? '').trim();
  const role = String(entry.role ?? '').trim();
  if (!email || !ROLES.has(role)) {
    console.error(`skip   ${email || '(no email)'} — needs an email and a role of ${[...ROLES].join('/')}`);
    continue;
  }

  const password = entry.password?.trim() ? entry.password : makePassword();
  const generated = !entry.password?.trim();

  let user = await findUser(email);
  if (user) {
    // Keep the password in step with the file so the e2e suite can always sign in.
    const { error } = await db.auth.admin.updateUserById(user.id, {
      password, email_confirm: true, user_metadata: { name },
    });
    if (error) { console.error(`failed ${email}: ${error.message}`); process.exit(1); }
    console.log(`reuse  ${email.padEnd(28)} ${role}`);
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { name },
    });
    if (error) { console.error(`failed ${email}: ${error.message}`); process.exit(1); }
    user = data.user;
    console.log(`create ${email.padEnd(28)} ${role}`);
  }

  const { error: upErr } = await db
    .from('admins')
    .upsert({ user_id: user.id, email, name, role }, { onConflict: 'user_id' });
  if (upErr) { console.error(`failed role for ${email}: ${upErr.message}`); process.exit(1); }

  rows.push({ role, email, password, generated });
}

const LABEL = { po: 'Product Owner', pm: 'Project Manager', registration: 'Registration', crowd: 'Crowd' };
const order = ['po', 'pm', 'registration', 'crowd'];
rows.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

writeFileSync('test-accounts.local.md', [
  '# Staff logins (local only - do not commit)',
  '',
  `Generated ${new Date().toISOString()} by \`npm run create-admins\` from \`admins.local.json\`.`,
  'The e2e suite reads this file. Change the shared passwords after testing,',
  'and remove the throwaway @tour.test accounts before launch.',
  '',
  '| Role | Email | Password |',
  '| --- | --- | --- |',
  ...rows.map((r) => `| ${LABEL[r.role]} | ${r.email} | \`${r.password}\` |`),
  '',
  rows.some((r) => r.generated)
    ? `Generated (random) passwords: ${rows.filter((r) => r.generated).map((r) => r.email).join(', ')}`
    : 'All passwords came from admins.local.json.',
  '',
].join('\n'));

console.log(`\n${rows.length} admin(s) ready. Credentials written to test-accounts.local.md (git-ignored).`);
