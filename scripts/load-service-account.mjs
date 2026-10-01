// Reads service-account.json and writes the three Admin SDK values into .env.local.
// Every other line in .env.local is left exactly as it was. Never prints secret values.
// Usage: node scripts/load-service-account.mjs [path-to-key.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const keyPath = process.argv[2] ?? 'service-account.json';
if (!existsSync(keyPath)) {
  console.error(`Not found: ${keyPath}`);
  process.exit(1);
}

let key;
try {
  key = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch {
  console.error(`${keyPath} is not valid JSON. Re-download the key.`);
  process.exit(1);
}

const missing = ['project_id', 'client_email', 'private_key'].filter((f) => !key[f]);
if (missing.length) {
  console.error(`${keyPath} is missing: ${missing.join(', ')}. Is this a service-account key?`);
  process.exit(1);
}

// Store the PEM on one line with literal \n, wrapped in double quotes, as the README requires.
const values = {
  FIREBASE_PROJECT_ID: key.project_id,
  FIREBASE_CLIENT_EMAIL: key.client_email,
  FIREBASE_PRIVATE_KEY: `"${key.private_key.replace(/\r?\n/g, '\\n')}"`,
};

const envPath = '.env.local';
const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split('\n') : [];
const seen = new Set();

const out = lines.map((line) => {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
  if (!m || !(m[1] in values)) return line;
  seen.add(m[1]);
  return `${m[1]}=${values[m[1]]}`;
});

for (const [k, v] of Object.entries(values)) {
  if (!seen.has(k)) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push(`${k}=${v}`);
  }
}

writeFileSync(envPath, out.join('\n'));
console.log(`Wrote FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to ${envPath}.`);
console.log('Values were not printed.');
