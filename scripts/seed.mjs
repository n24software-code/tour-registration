// Seeds the tours. Idempotent: run it as often as you like.
//
//   npm run seed            apply
//   npm run seed -- --dry   show the plan, write nothing
//
// SABIC and Saudi Aramco run two departures each, one tour row per batch. Any other
// row belonging to those destinations — an old un-batched SABIC, a stray third batch —
// is deleted, so the public form can never show a stale departure.
//
// registered_count is recomputed from the real number of non-cancelled registrations
// rather than trusted, so the counter can't drift.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const DRY = process.argv.includes('--dry');
const { NEXT_PUBLIC_SUPABASE_URL: URL, SUPABASE_SECRET_KEY: KEY } = process.env;
if (!URL || !KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.');
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const SABIC_RESTRICTED = ['IQ', 'YE', 'LB', 'SY'];

const BOULEVARD_NOTICES = [
  'Photography is strictly prohibited inside the experience.',
  'Pregnant women are not allowed to participate.',
  'Visitors with heart conditions or high blood pressure are not allowed to participate.',
  'Visitors who have recently undergone surgery are not allowed to participate.',
];

/** The only tours that should exist. Ids are fixed so the upsert is stable. */
export const TOURS = [
  { id: 'kapsarc-black-gold', destination_id: 'kapsarc-black-gold', batch: null,
    name: 'KAPSARC & Black Gold Museum', slot: 'morning', departure_time: '08:00', capacity: 50 },

  { id: 'sabic-b1', destination_id: 'sabic', batch: 1,
    name: 'SABIC - Home of Innovation', slot: 'morning', departure_time: '08:00', capacity: 20,
    restricted_nationalities: SABIC_RESTRICTED },
  { id: 'sabic-b2', destination_id: 'sabic', batch: 2,
    name: 'SABIC - Home of Innovation', slot: 'morning', departure_time: '09:00', capacity: 20,
    restricted_nationalities: SABIC_RESTRICTED },

  { id: 'aramco-b1', destination_id: 'aramco-kafd', batch: 1,
    name: 'Saudi Aramco - KAFD', slot: 'morning', departure_time: '09:00', capacity: 10 },
  { id: 'aramco-b2', destination_id: 'aramco-kafd', batch: 2,
    name: 'Saudi Aramco - KAFD', slot: 'morning', departure_time: '10:00', capacity: 10 },

  { id: 'diriyah-heritage-trail', destination_id: 'diriyah-heritage-trail', batch: null,
    name: 'Heritage Trail - Diriyah', slot: 'evening', departure_time: '16:30', capacity: 50 },
  { id: 'downtown-national-history', destination_id: 'downtown-national-history', batch: null,
    name: 'Downtown & National History', slot: 'evening', departure_time: '17:00', capacity: 50 },
  { id: 'boulevard-city', destination_id: 'boulevard-city', batch: null,
    name: 'Boulevard City', slot: 'evening', departure_time: '16:00', capacity: 50,
    experience_duration: '15–20 minutes from entering the experience venue',
    notices: BOULEVARD_NOTICES },
].map((t, i) => ({
  pickup_point: 'Main pickup area',
  tour_date: null,
  active: true,
  restricted_nationalities: [],
  experience_duration: null,
  notices: [],
  ...t,
  sort_order: i + 1,
}));

const KEEP = new Set(TOURS.map((t) => t.id));
/** Destinations that run in batches; any un-batched row of theirs is stale. */
const BATCHED_DESTINATIONS = new Set(
  TOURS.filter((t) => t.batch !== null).map((t) => t.destination_id)
);
const BATCHED_NAMES = new Set(
  TOURS.filter((t) => t.batch !== null).map((t) => t.name.toLowerCase())
);

const fail = (what, error) => { console.error(`${what}: ${error.message}`); process.exit(1); };

// ---------------------------------------------------------------- stale rows
const { data: existing, error: readErr } = await db
  .from('tours').select('id, name, destination_id, batch, departure_time, capacity');
if (readErr) fail('reading tours', readErr);

const stale = (existing ?? []).filter((t) => {
  if (KEEP.has(t.id)) return false;
  // Belongs to a batched destination but isn't one of the four we keep…
  if (BATCHED_DESTINATIONS.has(t.destination_id)) return true;
  // …or carries a batched tour's name without being a batch at all.
  return BATCHED_NAMES.has(String(t.name ?? '').toLowerCase()) && t.batch === null;
});

for (const t of stale) {
  console.log(`stale  ${t.id} (${t.name}, batch ${t.batch ?? '—'}, ${t.departure_time}) → delete`);
}
if (stale.length && !DRY) {
  const ids = stale.map((t) => t.id);
  // A tour with registrations can't be deleted (FK is ON DELETE RESTRICT), which is
  // the right outcome: moving those people is a decision, not a migration.
  const { error } = await db.from('tours').delete().in('id', ids);
  if (error) {
    console.error(
      `\nCould not delete ${ids.join(', ')}: ${error.message}\n` +
      'Those tours still have registrations. Move or cancel them first, then re-run.'
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------- upsert
for (const t of TOURS) {
  const before = (existing ?? []).find((e) => e.id === t.id);
  console.log(
    `${before ? 'update' : 'insert'} ${t.id.padEnd(26)} ` +
    `${(t.batch ? `batch ${t.batch}` : '—').padEnd(8)} ${t.departure_time}  cap ${t.capacity}`
  );
}
if (!DRY) {
  const { error } = await db.from('tours').upsert(TOURS, { onConflict: 'id' });
  if (error) fail('upserting tours', error);
}

// ---------------------------------------------------------------- real counts
// registered_count is the seat ledger; recompute it so a stale value can't overbook.
const { data: regs, error: regErr } = await db
  .from('registrations').select('tour_id').neq('status', 'cancelled');
if (regErr) fail('counting registrations', regErr);

const counts = new Map();
for (const r of regs ?? []) counts.set(r.tour_id, (counts.get(r.tour_id) ?? 0) + 1);

let fixed = 0;
for (const t of TOURS) {
  const real = counts.get(t.id) ?? 0;
  const was = (existing ?? []).find((e) => e.id === t.id);
  if (was && real === undefined) continue;
  if (!DRY) {
    const { error } = await db.from('tours').update({ registered_count: real }).eq('id', t.id);
    if (error) fail(`setting registered_count for ${t.id}`, error);
  }
  if (real > 0) { console.log(`count  ${t.id} → ${real} registered`); fixed++; }
}

console.log(
  `\n${DRY ? 'Dry run. ' : ''}${TOURS.length} tours, ` +
  `${stale.length} stale row(s) ${DRY ? 'to delete' : 'deleted'}, ${fixed} with live registrations.`
);
