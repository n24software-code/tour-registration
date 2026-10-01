// Reports only "set" or "missing" for each key. Never prints values.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'NEXT_PUBLIC_FIREBASE_APP_ID',
  'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
];

let bad = 0;
for (const k of KEYS) {
  const v = process.env[k] ?? '';
  const ok = v !== '' && v !== 'REPLACE_ME' && !v.includes('REPLACE_ME');
  if (!ok) bad++;
  console.log(`${ok ? 'set     ' : 'MISSING '} ${k}`);
}
process.exit(bad ? 1 : 0);
