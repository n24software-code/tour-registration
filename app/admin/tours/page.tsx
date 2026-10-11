'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRunner, useTours } from '@/lib/hooks';
import { addTour, saveTour, type TourFields } from '@/lib/actions';
import { NATIONALITIES, nationalityLabel } from '@/lib/nationalities';
import type { Admin, Slot, Tour } from '@/lib/types';
import { ErrorNote, SlotMark } from '@/components/ui';

const fieldsOf = (t: Tour): TourFields => ({
  name: t.name, slot: t.slot, pickupPoint: t.pickupPoint, departureTime: t.departureTime,
  date: t.date ?? '', capacity: t.capacity, active: t.active,
  restrictedNationalities: t.restrictedNationalities ?? [],
  experienceDuration: t.experienceDuration ?? '',
  notices: t.notices ?? [],
  destinationId: t.destinationId ?? t.id,
  batch: t.batch ?? null,
});
const blank: TourFields = {
  name: '', slot: 'morning', pickupPoint: 'Main pickup area', departureTime: '08:00',
  date: '', capacity: 50, active: true, restrictedNationalities: [],
  experienceDuration: '', notices: [], destinationId: '', batch: null,
};

const picked = (el: HTMLSelectElement) => Array.from(el.selectedOptions, (o) => o.value);

/**
 * A <select multiple> always reports its selection in DOM (alphabetical) order, but the
 * stored order is what builds the refusal message — "Iraqi, Yemeni, Lebanese or Syrian".
 * So keep the codes that are still selected in the order the tour already had them, and
 * append anything newly ticked.
 */
const merge = (prev: string[], next: string[]) =>
  [...prev.filter((c) => next.includes(c)), ...next.filter((c) => !prev.includes(c))];

/** Multi-select over the full nationality list. Empty means "open to everyone". */
function RestrictedPicker({ id, label, value, onChange }: {
  id: string; label: string; value: string[]; onChange: (codes: string[]) => void;
}) {
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select
        id={id} multiple size={4} className="input min-w-[11rem] py-1"
        value={value}
        onChange={(e) => onChange(merge(value, picked(e.currentTarget)))}
      >
        {NATIONALITIES.map((n) => <option key={n.code} value={n.code}>{n.label}</option>)}
      </select>
      <div className="mt-1 max-w-[11rem] text-xs text-ink/70">
        {value.length ? `Blocked: ${value.map(nationalityLabel).join(', ')}` : 'Open to every nationality'}
      </div>
      {value.length > 0 && (
        <button type="button" className="mt-1 text-xs underline" onClick={() => onChange([])}>
          Clear restrictions
        </button>
      )}
    </>
  );
}

/**
 * Trip information shown to visitors before they book: how long the experience takes,
 * and any conditions they have to confirm. A tour with notices makes the consent
 * checkbox on the public form required.
 */
function TripInfoEditor({ idFor, label, duration, notices, onChange }: {
  idFor: (f: string) => string;
  label: string;
  duration: string;
  notices: string[];
  onChange: (patch: { experienceDuration?: string; notices?: string[] }) => void;
}) {
  const setNotice = (i: number, value: string) =>
    onChange({ notices: notices.map((n, j) => (j === i ? value : n)) });
  return (
    <div className="min-w-[18rem] space-y-2">
      <label htmlFor={idFor('duration')} className="sr-only">Experience duration for {label}</label>
      <input
        id={idFor('duration')} className="input" placeholder="Experience duration (optional)"
        value={duration} onChange={(e) => onChange({ experienceDuration: e.target.value })}
      />
      <ul className="space-y-1.5">
        {notices.map((n, i) => (
          <li key={i} className="flex gap-1.5">
            <label htmlFor={idFor(`notice-${i}`)} className="sr-only">
              Notice {i + 1} for {label}
            </label>
            <input
              id={idFor(`notice-${i}`)} className="input" value={n}
              onChange={(e) => setNotice(i, e.target.value)}
            />
            <button
              type="button" className="btn-ghost btn-sm shrink-0"
              aria-label={`Remove notice ${i + 1} for ${label}`}
              onClick={() => onChange({ notices: notices.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn-ghost btn-sm" onClick={() => onChange({ notices: [...notices, ''] })}>
        Add notice
      </button>
      {notices.length > 0 && (
        <p className="text-xs text-ink/70">Visitors must tick a box to confirm these before booking.</p>
      )}
    </div>
  );
}

function TourRow({ tour, admin, run, busy }: {
  tour: Tour; admin: Admin; run: ReturnType<typeof useRunner>['run']; busy: string | null;
}) {
  const original = fieldsOf(tour);
  const [t, setT] = useState(original);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(t) !== JSON.stringify(original);

  // Pick up changes made by someone else, unless this row has unsaved edits.
  const key = JSON.stringify(original);
  useEffect(() => { if (!dirty) setT(JSON.parse(key)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const id = (f: string) => `${tour.id}-${f}`;
  // Two batches of one destination share a name, so the accessible labels have to
  // name the batch as well or they are ambiguous for everyone, not just the tests.
  const who = tour.batch ? `${tour.name} Batch ${tour.batch}` : tour.name;
  const tooLow = t.capacity < tour.registeredCount;

  return (
    <tr className="border-b border-ink/5 last:border-0">
      <td className="cell">
        <span className="flex items-center gap-2"><SlotMark slot={t.slot} />
          <label htmlFor={id('name')} className="sr-only">Tour name</label>
          <input id={id('name')} className="input" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
        </span>
      </td>
      <td className="cell">
        <label htmlFor={id('pickup')} className="sr-only">Pickup point for {who}</label>
        <input id={id('pickup')} className="input" value={t.pickupPoint} onChange={(e) => setT({ ...t, pickupPoint: e.target.value })} />
      </td>
      <td className="cell">
        <label htmlFor={id('date')} className="sr-only">Date for {who}</label>
        <input id={id('date')} type="date" className="input" value={t.date} onChange={(e) => setT({ ...t, date: e.target.value })} />
      </td>
      <td className="cell">
        <label htmlFor={id('time')} className="sr-only">Departure time for {who}</label>
        <input id={id('time')} type="time" className="input" value={t.departureTime} onChange={(e) => setT({ ...t, departureTime: e.target.value })} />
      </td>
      <td className="cell whitespace-nowrap">
        <label htmlFor={id('cap')} className="sr-only">Capacity for {who}</label>
        <input id={id('cap')} type="number" min={Math.max(1, tour.registeredCount)} className="input w-24" value={t.capacity}
          aria-invalid={tooLow} onChange={(e) => setT({ ...t, capacity: Number(e.target.value) })} />
        <div className={`mt-1 text-xs ${tooLow ? 'text-clay' : 'text-ink/70'}`}>
          {tooLow ? `Min ${tour.registeredCount} (already registered)` : `${tour.registeredCount} registered`}
        </div>
      </td>
      <td className="cell">
        <RestrictedPicker
          id={id('restricted')} label={`Restricted nationalities for ${who}`}
          value={t.restrictedNationalities}
          onChange={(codes) => setT({ ...t, restrictedNationalities: codes })}
        />
      </td>
      <td className="cell">
        <TripInfoEditor
          idFor={id} label={who}
          duration={t.experienceDuration} notices={t.notices}
          onChange={(patch) => setT({ ...t, ...patch })}
        />
      </td>
      <td className="cell">
        <label className="flex min-h-[44px] items-center gap-2 whitespace-nowrap">
          <input type="checkbox" className="h-4 w-4 accent-palm" checked={t.active} onChange={(e) => setT({ ...t, active: e.target.checked })} />
          {t.active ? 'Open' : 'Closed'}
        </label>
      </td>
      <td className="cell">
        <div className="flex gap-2">
          <button className="btn-primary btn-sm" disabled={!dirty || tooLow || busy === tour.id}
            onClick={() => run(tour.id, async () => {
              await saveTour(tour.id, t, admin);
              setSaved(true); setTimeout(() => setSaved(false), 1500);
            })}>
            {saved ? 'Saved' : 'Save'}
          </button>
          {dirty && <button className="btn-ghost btn-sm" onClick={() => setT(original)}>Reset</button>}
        </div>
      </td>
    </tr>
  );
}

export default function ToursPage() {
  const { admin } = useAuth();
  const { data: tours, loading, error } = useTours();
  const { run, busy, error: actionError, clearError } = useRunner();
  const [form, setForm] = useState<TourFields>(blank);
  const addForm = useRef<HTMLFormElement>(null);

  // Batches of one destination sit together, in departure order.
  const groupedTours = useMemo(() => {
    const groups = new Map<string, Tour[]>();
    for (const t of tours) {
      const key = t.destinationId || t.id;
      const list = groups.get(key);
      if (list) list.push(t); else groups.set(key, [t]);
    }
    return [...groups.entries()]
      .map(([id, list]) => ({
        id,
        name: list[0].name,
        batches: [...list].sort(
          (a, b) => (a.batch ?? 0) - (b.batch ?? 0) || a.departureTime.localeCompare(b.departureTime)
        ),
      }))
      .sort((a, b) => Math.min(...a.batches.map((t) => t.order)) - Math.min(...b.batches.map((t) => t.order)));
  }, [tours]);

  /** Pre-fills the add form with the next batch of an existing destination. */
  function addBatchFor(batches: Tour[]) {
    const last = batches[batches.length - 1];
    setForm({
      ...fieldsOf(last),
      destinationId: last.destinationId ?? last.id,
      batch: Math.max(0, ...batches.map((b) => b.batch ?? 0)) + 1,
      capacity: last.capacity,
    });
    addForm.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    addForm.current?.querySelector<HTMLInputElement>('#new-time')?.focus();
  }

  if (!admin) return null;

  function add(e: React.FormEvent) {
    e.preventDefault();
    run('new', async () => {
      await addTour(form, Math.max(0, ...tours.map((t) => t.order)) + 1, admin!);
      setForm(blank);
    });
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Tours</h1>
      <p className="mt-1 text-sm text-ink/70">
        Edit a row and press Save. Closing a tour hides it from new registrations but keeps everyone already registered.
        Restricted nationalities are refused by the server as well as the form, and a tour with notices makes
        visitors confirm them before they can book.
      </p>
      <ErrorNote message={error} />
      <ErrorNote message={actionError} onClose={clearError} />

      <div className="mt-6 overflow-x-auto rounded-md border border-ink/10 bg-white">
        <table className="w-full min-w-[1500px] text-sm">
          <thead className="table-head"><tr>
            <th className="cell">Tour</th><th className="cell">Pickup point</th><th className="cell">Date</th>
            <th className="cell">Departs</th><th className="cell">Capacity</th>
            <th className="cell">Restricted nationalities</th>
            <th className="cell">Trip information</th>
            <th className="cell">Registration</th>
            <th className="cell"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {groupedTours.map(({ id, name, batches }) => (
              <Fragment key={id}>
                {batches.length > 1 && (
                  <tr className="border-b border-ink/10 bg-paper">
                    <td className="cell font-semibold" colSpan={10}>
                      {name}
                      <span className="ml-2 font-normal text-ink/60">
                        {batches.length} batches
                      </span>
                      <button
                        type="button" className="btn-ghost btn-sm ml-3"
                        onClick={() => addBatchFor(batches)}
                      >
                        Add batch
                      </button>
                    </td>
                  </tr>
                )}
                {batches.map((t) => (
                  <TourRow key={t.id} tour={t} admin={admin} run={run} busy={busy} />
                ))}
                {batches.length === 1 && (
                  <tr className="border-b border-ink/5">
                    <td className="cell" colSpan={10}>
                      <button
                        type="button" className="btn-ghost btn-sm"
                        onClick={() => addBatchFor(batches)}
                      >
                        Add a batch to {name}
                      </button>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {loading && <p className="p-4 text-ink/70" role="status">Loading…</p>}
        {!loading && tours.length === 0 && <p className="p-6 text-ink/70">No tours yet. Add your first tour below.</p>}
      </div>

      <form ref={addForm} onSubmit={add} className="mt-8 rounded-md border border-ink/10 bg-white p-4">
        <h2 className="font-semibold">
          {form.batch ? `Add batch ${form.batch} of ${form.name || 'a destination'}` : 'Add a tour'}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <label htmlFor="new-name" className="label">Tour name</label>
            <input id="new-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="sm:col-span-1">
            <label htmlFor="new-slot" className="label">Time of day</label>
            <select id="new-slot" className="input" value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value as Slot })}>
              <option value="morning">Morning</option><option value="evening">Evening</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="new-pickup" className="label">Pickup point</label>
            <input id="new-pickup" className="input" value={form.pickupPoint} onChange={(e) => setForm({ ...form, pickupPoint: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="new-date" className="label">Date (optional)</label>
            <input id="new-date" type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="sm:col-span-1">
            <label htmlFor="new-time" className="label">Departs</label>
            <input id="new-time" type="time" className="input" value={form.departureTime} onChange={(e) => setForm({ ...form, departureTime: e.target.value })} />
          </div>
          <div className="sm:col-span-1">
            <label htmlFor="new-batch" className="label">Batch</label>
            <input id="new-batch" type="number" min={1} className="input" placeholder="—"
              value={form.batch ?? ''}
              onChange={(e) => setForm({ ...form, batch: e.target.value ? Number(e.target.value) : null })} />
            <p className="mt-1 text-xs text-ink/70">Leave blank for a one-off tour.</p>
          </div>
          <div className="sm:col-span-1">
            <label htmlFor="new-cap" className="label">Seats</label>
            <input id="new-cap" type="number" min={1} className="input" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="new-restricted" className="label">Restricted nationalities</label>
            <select id="new-restricted" multiple size={4} className="input py-1"
              value={form.restrictedNationalities}
              onChange={(e) => setForm({
                ...form,
                restrictedNationalities: merge(form.restrictedNationalities, picked(e.currentTarget)),
              })}>
              {NATIONALITIES.map((n) => <option key={n.code} value={n.code}>{n.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-ink/70">
              {form.restrictedNationalities.length
                ? `Blocked: ${form.restrictedNationalities.map(nationalityLabel).join(', ')}`
                : 'Leave empty to welcome every nationality.'}
            </p>
          </div>
          <div className="sm:col-span-2">
            <span className="label block">Trip information</span>
            <TripInfoEditor
              idFor={(f) => `new-${f}`} label="the new tour"
              duration={form.experienceDuration} notices={form.notices}
              onChange={(patch) => setForm({ ...form, ...patch })}
            />
          </div>
          <div className="flex items-end sm:col-span-2">
            <button className="btn-primary w-full" disabled={busy === 'new'}>Add tour</button>
          </div>
        </div>
      </form>
    </>
  );
}
