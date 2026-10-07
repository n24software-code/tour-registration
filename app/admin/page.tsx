'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useRegistrations, useTours } from '@/lib/hooks';
import { can } from '@/lib/roles';
import { buildTrips, countMismatches, groupByTrip, tripCounts } from '@/lib/trips';
import type { Registration, Status } from '@/lib/types';
import { ErrorNote, SlotMark, formatTourDate } from '@/components/ui';

const COLS: { key: Status; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'checked_in', label: 'At pickup' },
  { key: 'boarded', label: 'On bus' },
  { key: 'no_show', label: 'No-show' },
];

export default function Overview() {
  const { admin } = useAuth();
  const { data: tours, loading: toursLoading, error: toursError } = useTours();
  const { data: regs, loading, error } = useRegistrations();
  const flagged = regs.filter((r) => r.flag && r.status !== 'cancelled').length;

  // Same grouping as the Registrations and Crowd pages: destination + date + departure time.
  const trips = useMemo(() => buildTrips(tours, regs), [tours, regs]);
  const byTrip = useMemo(() => groupByTrip(regs, tours), [regs, tours]);
  // Seat-counter drift is a data problem, so only the people who can fix it are told.
  const mismatches = useMemo(
    () => (can(admin?.role, 'manageTours') ? countMismatches(tours, regs) : new Map()),
    [tours, regs, admin?.role]
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <p className="mt-1 text-sm text-ink/70">Live numbers, one row per trip. Updates on its own.</p>

      {flagged > 0 && (
        <p className="mt-4 rounded-md bg-clay/10 px-4 py-3 text-sm text-clay">
          <b>{flagged}</b> registration{flagged > 1 ? 's are' : ' is'} flagged by the Crowd team.{' '}
          {can(admin?.role, 'manageRegistrations') && <Link className="underline" href="/admin/registrations">Review flags</Link>}
        </p>
      )}
      <ErrorNote message={toursError || error} />

      <div className="mt-6 overflow-x-auto rounded-md border border-ink/10 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="table-head"><tr>
            <th className="cell">Trip</th><th className="cell">Registered</th><th className="cell">Seats left</th>
            {COLS.map((c) => <th key={c.key} className="cell text-right">{c.label}</th>)}
          </tr></thead>
          <tbody>
            {trips.map((t) => {
              const mine: Registration[] = byTrip.get(t.key) ?? [];
              const counts = tripCounts(mine, t.capacity);
              const count = (s: Status) => mine.filter((r) => r.status === s).length;
              const mismatch = mismatches.get(t.tourId);
              return (
                <tr key={t.key} className="border-b border-ink/5 last:border-0" data-trip={t.key}>
                  <td className="cell">
                    <span className="flex items-center gap-2 font-medium"><SlotMark slot={t.slot} />{t.tourName}</span>
                    <span className="text-xs text-ink/60">
                      {formatTourDate(t.date)} · {t.departureTime}
                      {t.tour && !t.tour.active && ' · Registration closed'}
                    </span>
                    {mismatch && (
                      <span className="mt-1 block rounded bg-clay/10 px-2 py-1 text-xs font-medium text-clay">
                        Count mismatch: {mismatch.counted} registered here, seat counter says {mismatch.stored}.
                      </span>
                    )}
                  </td>
                  <td className="cell whitespace-nowrap font-semibold tabular-nums">
                    {counts.registered} / {counts.capacity}
                  </td>
                  <td className="cell whitespace-nowrap tabular-nums">{counts.seatsLeft}</td>
                  {COLS.map((c) => <td key={c.key} className="cell text-right tabular-nums">{count(c.key)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {(loading || toursLoading) && <p className="p-4 text-ink/70" role="status">Loading…</p>}
        {!toursLoading && trips.length === 0 && (
          <p className="p-6 text-ink/70">No tours yet. Run the seed script or add one on the Tours page.</p>
        )}
      </div>
    </>
  );
}
