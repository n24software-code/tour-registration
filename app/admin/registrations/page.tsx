'use client';
import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRegistrations, useRunner, useTours } from '@/lib/hooks';
import { cancelRegistration, setFlag, setStatus } from '@/lib/actions';
import { STATUS_LABEL, type Registration, type Status } from '@/lib/types';
import { ErrorNote, SlotMark, StatusBadge } from '@/components/ui';

type Filter = Status | 'flagged' | '';

function toCsv(rows: Registration[]) {
  const head = ['Code', 'Name', 'Email', 'Phone', 'Tour', 'Status', 'Bus', 'Registered at'];
  // Prefix formula-like values so spreadsheets don't execute them.
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  return [head, ...rows.map((r) => [
    r.id, r.name, r.email, r.phone, r.tourName, STATUS_LABEL[r.status], r.busNumber,
    r.createdAt?.toDate().toLocaleString('en-GB'),
  ])].map((row) => row.map(esc).join(',')).join('\r\n');
}

export default function RegistrationsPage() {
  const { admin } = useAuth();
  const { data: tours } = useTours();
  const { data: regs, loading, error } = useRegistrations();
  const { run, busy, error: actionError, clearError } = useRunner();
  const [tourId, setTourId] = useState('');
  const [status, setStatusFilter] = useState<Filter>('');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return regs
      .filter((r) => !tourId || r.tourId === tourId)
      .filter((r) => !status || (status === 'flagged' ? !!r.flag : r.status === status))
      .filter((r) => !s || [r.id, r.name, r.email, r.phone].some((v) => (v ?? '').toLowerCase().includes(s)))
      .sort((a, b) => Number(!!b.flag) - Number(!!a.flag)); // flagged first; stable keeps newest-first
  }, [regs, tourId, status, q]);

  function exportCsv() {
    const url = URL.createObjectURL(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), {
      href: url, download: `registrations-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!admin) return null;
  const pendingCount = regs.filter((r) => r.status === 'pending').length;
  const flaggedCount = regs.filter((r) => r.flag).length;
  const filtered = !!(q || tourId || status);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Registrations</h1>
          <p className="mt-1 text-sm text-ink/70">
            Confirm visitors to hand them over to the Crowd team. {pendingCount} waiting for review
            {flaggedCount > 0 && <>, <span className="font-medium text-clay">{flaggedCount} flagged</span></>}.
          </p>
        </div>
        <button className="btn-ghost" onClick={exportCsv} disabled={!rows.length}>Export CSV ({rows.length})</button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-[1fr,auto,auto]">
        <div>
          <label htmlFor="q" className="sr-only">Search</label>
          <input id="q" type="search" className="input" placeholder="Search code, name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label htmlFor="tour" className="sr-only">Tour</label>
          <select id="tour" className="input" value={tourId} onChange={(e) => setTourId(e.target.value)}>
            <option value="">All tours</option>
            {tours.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="sr-only">Status</label>
          <select id="status" className="input" value={status} onChange={(e) => setStatusFilter(e.target.value as Filter)}>
            <option value="">All statuses</option>
            <option value="flagged">Flagged by Crowd team</option>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
      </div>

      <ErrorNote message={error} />
      <ErrorNote message={actionError} onClose={clearError} />

      <div className="mt-4 overflow-x-auto rounded-md border border-ink/10 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="table-head"><tr>
            <th className="cell">Code</th><th className="cell">Visitor</th><th className="cell">Tour</th>
            <th className="cell">Status</th><th className="cell text-right">Actions</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-b border-ink/5 last:border-0 ${r.flag ? 'bg-clay/[0.07] shadow-[inset_4px_0_0_#B4412F]' : ''}`}>
                <td className="cell font-mono font-semibold tracking-wider">{r.id}</td>
                <td className="cell">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-ink/70">{r.email} · <a className="underline" href={`tel:${r.phone}`}>{r.phone}</a></div>
                  {r.flag && <div className="mt-1 text-xs font-medium text-clay">Crowd team: {r.flag}</div>}
                </td>
                <td className="cell"><span className="flex items-center gap-2"><SlotMark slot={r.slot} />{r.tourName}</span></td>
                <td className="cell">
                  <StatusBadge status={r.status} />
                  {r.busNumber && <div className="mt-1 text-xs text-ink/70">Bus {r.busNumber}</div>}
                </td>
                <td className="cell">
                  <div className="flex justify-end gap-2">
                    {r.status === 'pending' && (
                      <button className="btn-primary btn-sm" disabled={busy === r.id}
                        onClick={() => run(r.id, () => setStatus(r, 'confirmed', admin))}>Confirm</button>
                    )}
                    {r.flag && (
                      <button className="btn-ghost btn-sm" disabled={busy === r.id}
                        onClick={() => run(r.id, () => setFlag(r, null, admin))}>Mark resolved</button>
                    )}
                    {r.status !== 'cancelled' && r.status !== 'boarded' && (
                      <button className="btn-danger btn-sm" disabled={busy === r.id}
                        onClick={() => confirm(`Cancel ${r.name}'s registration (${r.id})? Their seat on ${r.tourName} will be released.`)
                          && run(r.id, () => cancelRegistration(r, admin))}>
                        Cancel
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="p-4 text-ink/70" role="status">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="p-6 text-ink/70">
            {filtered ? 'No registrations match. Clear the search or change the filters.' : 'No registrations yet. Share the registration page link with visitors.'}
          </p>
        )}
      </div>
    </>
  );
}
