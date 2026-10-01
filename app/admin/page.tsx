'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useRegistrations, useTours } from '@/lib/hooks';
import { can } from '@/lib/roles';
import type { Status } from '@/lib/types';
import { ErrorNote, SlotMark } from '@/components/ui';

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

  return (
    <>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <p className="mt-1 text-sm text-ink/70">Live numbers across all tours. Updates on its own.</p>

      {flagged > 0 && (
        <p className="mt-4 rounded-md bg-clay/10 px-4 py-3 text-sm text-clay">
          <b>{flagged}</b> registration{flagged > 1 ? 's are' : ' is'} flagged by the Crowd team.{' '}
          {can(admin?.role, 'manageRegistrations') && <Link className="underline" href="/admin/registrations">Review flags</Link>}
        </p>
      )}
      <ErrorNote message={toursError || error} />

      <div className="mt-6 overflow-x-auto rounded-md border border-ink/10 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="table-head"><tr>
            <th className="cell">Tour</th><th className="cell">Registered</th>
            {COLS.map((c) => <th key={c.key} className="cell text-right">{c.label}</th>)}
          </tr></thead>
          <tbody>
            {tours.map((t) => {
              const mine = regs.filter((r) => r.tourId === t.id);
              const count = (s: Status) => mine.filter((r) => r.status === s).length;
              return (
                <tr key={t.id} className="border-b border-ink/5 last:border-0">
                  <td className="cell">
                    <span className="flex items-center gap-2 font-medium"><SlotMark slot={t.slot} />{t.name}</span>
                    <span className="text-xs text-ink/60">{t.departureTime}{t.date ? ` · ${t.date}` : ''}{!t.active && ' · Registration closed'}</span>
                  </td>
                  <td className="cell whitespace-nowrap tabular-nums">{t.registeredCount} / {t.capacity}</td>
                  {COLS.map((c) => <td key={c.key} className="cell text-right tabular-nums">{count(c.key)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {(loading || toursLoading) && <p className="p-4 text-ink/70" role="status">Loading…</p>}
        {!toursLoading && tours.length === 0 && (
          <p className="p-6 text-ink/70">No tours yet. Run the seed script or add one on the Tours page.</p>
        )}
      </div>
    </>
  );
}
