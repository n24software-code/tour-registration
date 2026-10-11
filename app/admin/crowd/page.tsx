'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRegistrations, useRunner, useTours } from '@/lib/hooks';
import { setFlag, setStatus } from '@/lib/actions';
import { nationalityLabel } from '@/lib/nationalities';
import { formatPhone, nationalDigits } from '@/lib/phone';
import { buildTrips, groupByTrip, tripCounts } from '@/lib/trips';
import { ID_TYPE_LABEL, type Registration, type Status } from '@/lib/types';
import { TourNoticesInline } from '@/components/TourNotices';
import { ErrorNote, SlotMark, StatusBadge, formatTourDate, orDash, tripLabel } from '@/components/ui';

// The Crowd team only works with visitors the Registration team has confirmed.
const ORDER: Partial<Record<Status, number>> = { checked_in: 0, confirmed: 1, no_show: 2, boarded: 3 };
const STORE = 'crowd-pickup';

function remember(v: { tripKey: string; bus: string }) {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export default function CrowdPage() {
  const { admin } = useAuth();
  const { data: tours } = useTours();
  const { data: regs, loading, error } = useRegistrations();
  const [tripKey, setTripKey] = useState('');
  const [bus, setBus] = useState('');
  const [q, setQ] = useState('');
  const [flagging, setFlagging] = useState<{ id: string; text: string } | null>(null);
  const { run, busy, error: actionError, clearError } = useRunner();

  // One trip = one bus run: destination + date + departure time.
  const trips = useMemo(() => buildTrips(tours, regs), [tours, regs]);
  const byTrip = useMemo(() => groupByTrip(regs, tours), [regs, tours]);
  const trip = trips.find((t) => t.key === tripKey);
  const mine: Registration[] = useMemo(() => (tripKey ? byTrip.get(tripKey) ?? [] : []), [byTrip, tripKey]);

  // Keep trip + bus across reloads on a phone at the pickup area.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
      if (saved.tripKey) setTripKey(saved.tripKey);
      if (saved.bus) setBus(saved.bus);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { remember({ tripKey, bus }); }, [tripKey, bus]);

  const handedOver = useMemo(() => mine.filter((r) => ORDER[r.status] !== undefined), [mine]);
  const pending = mine.filter((r) => r.status === 'pending').length;
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const digits = s.replace(/\D/g, '');
    return handedOver
      .filter((r) => {
        if (!s) return true;
        if (r.id.toLowerCase().includes(s) || r.name.toLowerCase().includes(s)) return true;
        if ((r.idNumber ?? '').toLowerCase().includes(s)) return true;
        if (digits.length < 3) return false;
        // Match the number with or without its country code: "0501234567", "501234567"
        // and "+966501234567" all have to find the same visitor.
        const stored = r.phone.replace(/\D/g, '');
        const national = nationalDigits(r.phone).replace(/\D/g, '');
        return stored.includes(digits) || national.includes(digits)
          || digits.includes(national) && national.length > 0;
      })
      .sort((a, b) => ORDER[a.status]! - ORDER[b.status]! || a.name.localeCompare(b.name));
  }, [handedOver, q]);

  const n = (s: Status) => handedOver.filter((r) => r.status === s).length;
  const counts = tripCounts(mine, trip?.capacity ?? 0);
  const busNo = bus.trim();

  function submitFlag(e: React.FormEvent, r: Registration) {
    e.preventDefault();
    const text = flagging?.text.trim();
    if (!text || !admin) return;
    run(r.id, async () => { await setFlag(r, text, admin); setFlagging(null); });
  }

  if (!admin) return null;

  return (
    <>
      <h1 className="text-2xl font-semibold">Pickup &amp; boarding</h1>
      <p className="mt-1 text-sm text-ink/70">Check visitors in when they arrive, then board them onto the bus.</p>

      <div className="mt-5 grid grid-cols-[1fr,7rem] gap-3 sm:max-w-xl">
        <div>
          <label htmlFor="tour" className="label">Trip</label>
          <select id="tour" className="input" value={tripKey} onChange={(e) => { setTripKey(e.target.value); setQ(''); }}>
            <option value="">Choose the trip you&rsquo;re running</option>
            {trips.map((t) => {
              // Same totals as Registrations and Overview, so Crowd can pick the right bus run.
              const c = tripCounts(byTrip.get(t.key) ?? [], t.capacity);
              return (
                <option key={t.key} value={t.key}>
                  {tripLabel(t)} — {c.registered} registered
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <label htmlFor="bus" className="label">Bus number</label>
          <input id="bus" className="input text-center font-semibold" inputMode="numeric" placeholder="e.g. 3"
            value={bus} maxLength={10} onChange={(e) => setBus(e.target.value)} />
        </div>
      </div>

      {!trip && <p className="mt-8 text-ink/70">Choose a trip to see the visitors who are expected at pickup.</p>}

      {trip && (
        <>
          <p className="mt-5 flex items-center gap-2 text-sm font-medium">
            <SlotMark slot={trip.slot} />{trip.pickupPoint} · bus leaves {trip.departureTime} · {formatTourDate(trip.date)}
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums">
            {counts.registered} registered
            <span className="font-normal text-ink/70"> · {counts.seatsLeft} seats left ({counts.capacity})</span>
          </p>
          {trip.tour && <TourNoticesInline tour={trip.tour} />}

          <dl className="mt-3 grid grid-cols-4 gap-2 text-center" aria-live="polite">
            {[
              ['Expected', handedOver.length, 'bg-white'],
              ['At pickup', n('checked_in'), 'bg-sun/20'],
              ['On bus', n('boarded'), 'bg-palm/15 text-palm'],
              ['No-show', n('no_show'), 'bg-clay/10 text-clay'],
            ].map(([label, value, cls]) => (
              <div key={label as string} className={`rounded-md border border-ink/10 px-1 py-2 ${cls}`}>
                <dt className="text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {pending > 0 && (
            <p className="mt-2 text-sm text-ink/70">{pending} more still pending with the Registration team (not shown here until confirmed).</p>
          )}

          <label htmlFor="search" className="sr-only">Find a visitor</label>
          <input id="search" type="search" autoFocus autoComplete="off" autoCapitalize="characters"
            className="input mt-5 py-3.5 text-lg tracking-wide" placeholder="Code, name, phone or passport"
            value={q} onChange={(e) => setQ(e.target.value)} />

          <ErrorNote message={error} />
          <ErrorNote message={actionError} onClose={clearError} />

          <ul className="mt-4 space-y-2">
            {rows.map((r) => {
              const isBusy = busy === r.id;
              return (
                <li key={r.id} className={`rounded-md border bg-white p-3 sm:p-4 ${r.flag ? 'border-clay/50' : 'border-ink/10'}`}>
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <span className="font-mono text-lg font-semibold tracking-wider">{r.id}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{r.name}</span>
                      <a href={`tel:${r.phone}`} className="block text-sm text-ink/70 underline">
                        {formatPhone(r.phone) || r.phone}
                      </a>
                      <span className="block text-xs text-ink/70">
                        {r.idType ? ID_TYPE_LABEL[r.idType] : 'ID'}{' '}
                        <span className="font-mono">{orDash(r.idNumber)}</span>
                        {' · '}{r.nationality ? nationalityLabel(r.nationality) : '—'}
                      </span>
                    </span>
                    <span className="text-right">
                      <StatusBadge status={r.status} />
                      {r.busNumber && <span className="mt-1 block text-xs text-ink/70">Bus {r.busNumber}</span>}
                    </span>
                  </div>
                  {r.flag && <p className="mt-2 rounded bg-clay/10 px-2 py-1 text-sm text-clay">Flagged: {r.flag}</p>}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.status === 'confirmed' && <>
                      <button className="btn-primary flex-1 sm:flex-none" disabled={isBusy}
                        onClick={() => run(r.id, () => setStatus(r, 'checked_in', admin))}>Check in</button>
                      <button className="btn-ghost" disabled={isBusy}
                        onClick={() => run(r.id, () => setStatus(r, 'no_show', admin))}>No-show</button>
                    </>}
                    {r.status === 'checked_in' && (
                      <button className="btn flex-1 bg-palm text-white hover:bg-palm/90 sm:flex-none" disabled={!busNo || isBusy}
                        onClick={() => run(r.id, () => setStatus(r, 'boarded', admin, busNo))}>
                        {busNo ? `Board bus ${busNo}` : 'Enter bus number to board'}
                      </button>
                    )}
                    {(r.status === 'checked_in' || r.status === 'no_show') && (
                      <button className="btn-ghost" disabled={isBusy}
                        onClick={() => run(r.id, () => setStatus(r, 'confirmed', admin))}>Undo</button>
                    )}
                    {!r.flag && flagging?.id !== r.id && (
                      <button className="btn-ghost" onClick={() => setFlagging({ id: r.id, text: '' })}>Flag issue</button>
                    )}
                  </div>

                  {flagging?.id === r.id && (
                    <form onSubmit={(e) => submitFlag(e, r)} className="mt-3 flex flex-wrap gap-2">
                      <label htmlFor={`flag-${r.id}`} className="sr-only">Message to the Registration team</label>
                      <input id={`flag-${r.id}`} className="input flex-1" autoFocus maxLength={200}
                        placeholder="What’s wrong? e.g. Name doesn’t match ID"
                        value={flagging.text} onChange={(e) => setFlagging({ id: r.id, text: e.target.value })} />
                      <button className="btn-primary" disabled={!flagging.text.trim() || isBusy}>Send flag</button>
                      <button type="button" className="btn-ghost" onClick={() => setFlagging(null)}>Cancel</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
          {loading && <p className="mt-4 text-ink/70" role="status">Loading…</p>}
          {!loading && rows.length === 0 && (
            <p className="mt-4 rounded-md border border-dashed border-ink/20 p-6 text-ink/70">
              {q
                ? 'No confirmed visitor matches. Check the code, or ask the Registration team if they are still pending.'
                : 'No confirmed visitors for this trip yet. They appear here as soon as the Registration team confirms them.'}
            </p>
          )}
        </>
      )}
    </>
  );
}
