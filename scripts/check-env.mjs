// Tells you which environment variables are set, without ever printing a value.
//   npm run check-env
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const GROUPS = {
  'Supabase (required)': [
    'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY',
  ],
  'Supabase CLI (only for db push)': ['SUPABASE_DB_PASSWORD'],
  'Site': ['NEXT_PUBLIC_SITE_URL'],
  'Email (required for confirmations)': [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM',
  ],
  'Optional': ['CRON_SECRET'],
};

let missing = 0;
for (const [group, keys] of Object.entries(GROUPS)) {
  console.log(`\n${group}`);
  for (const k of keys) {
    const set = !!process.env[k]?.trim();
    if (!set && !group.startsWith('Optional')) missing++;
    console.log(`  ${set ? '✓' : '✗'} ${k}`);
  }
}
console.log(missing ? `\n${missing} required variable(s) missing.` : '\nAll required variables are set.');
process.exit(missing ? 1 : 0);
