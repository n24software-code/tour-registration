'use client';
import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRegistrations, useRunner, useTours } from '@/lib/hooks';
import { cancelRegistration, deleteRegistration, logRegistrationsExport, setFlag, setStatus } from '@/lib/actions';
import { can } from '@/lib/roles';
import { nationalityLabel } from '@/lib/nationalities';
import { formatPhone } from '@/lib/phone';
import { MAIL_LABEL, MAIL_STYLE, useMailStatuses, type MailStatus } from '@/lib/mail-status';
import { buildTrips, countMismatches, groupByTrip, tripCounts, type Trip, type TripCounts } from '@/lib/trips';
import { exportTrips, tripFileName, type TripSheet } from '@/lib/excel';
import { ID_TYPE_LABEL, STATUS_LABEL, type Admin, type Registration, type Status } from '@/lib/types';
import { TourNoticesInline } from '@/components/TourNotices';
import {
  ErrorNote, SlotMark, StatusBadge, SuccessNote, formatTourDate, orDash,
} from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type Filter = Status | 'flagged' | '';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

/** Flagged rows first; the incoming order (newest first) is kept otherwise. */
const flaggedFirst = (rows: Registration[]) =>
  [...rows].sort((a, b) => Number(!!b.flag) - Number(!!a.flag));

/** The headline number for a trip, plus the per-status breakdown underneath it. */
function Counts({ counts, mismatch }: {
  counts: TripCounts;
  /** Only PO/PM get told when the seat counter has drifted; they are the ones who fix it. */
  mismatch?: { counted: number; stored: number };
}) {
  const chips: [string, number, string][] = [
    ['Pending', counts.pending, 'bg-ink/5'],
    ['Confirmed', counts.confirmed, 'bg-dusk/10 text-dusk'],
    ['At pickup', counts.checkedIn, 'bg-sun/20 text-[#6b4409]'],
    ['On bus', counts.boarded, 'bg-palm/15 text-palm'],
    ['No-show', counts.noShow, 'bg-clay/10 text-clay'],
    ['Flagged', counts.flagged, counts.flagged ? 'bg-clay text-white' : 'bg-ink/5'],
  ];
  return (
    <div aria-live="polite">
      <p className="text-base font-semibold tabular-nums">
        {counts.registered} registered
        <span className="font-normal text-ink/70"> · {counts.seatsLeft} seats left ({counts.capacity})</span>
      </p>
      <dl className="mt-1.5 flex flex-wrap gap-1.5">
        {chips.map(([label, value, cls]) => (
          <div key={label} className={`whitespace-nowrap rounded px-2 py-1 text-xs ${cls}`}>
            <dt className="inline opacity-80">{label} </dt>
            <dd className="inline font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
        {counts.cancelled > 0 && (
          <div className="whitespace-nowrap rounded bg-ink/5 px-2 py-1 text-xs text-ink/60">
            <dt className="inline">Cancelled </dt>
            <dd className="inline font-semibold tabular-nums">{counts.cancelled}</dd>
          </div>
        )}
      </dl>
      {mismatch && (
        <p className="mt-1.5 rounded bg-clay/10 px-2 py-1 text-xs font-medium text-clay">
          Count mismatch: {mismatch.counted} registered here, but the tour&rsquo;s seat counter says {mismatch.stored}.
        </p>
      )}
    </div>
  );
}

function Row({ reg: r, admin, run, busy, onDelete, mail }: {
  reg: Registration; admin: Admin; run: ReturnType<typeof useRunner>['run'];
  busy: string | null; onDelete: (r: Registration) => void; mail?: MailStatus;
}) {
  return (
    <tr className={`border-b border-ink/5 last:border-0 ${r.flag ? 'bg-clay/[0.07] shadow-[inset_4px_0_0_#B4412F]' : ''}`}>
      <td className="cell font-mono font-semibold tracking-wider">{r.id}</td>
      <td className="cell">
        <div className="font-medium">{r.name}</div>
        <div className="text-xs text-ink/70">
          <a className="underline" href={`tel:${r.phone}`}>{formatPhone(r.phone) || r.phone}</a>
        </div>
        {r.email && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink/70">
            <span>{r.email}</span>
            {mail && (
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${MAIL_STYLE[mail.state]}`}
                title={mail.error ?? undefined}>
                {MAIL_LABEL[mail.state]}
              </span>
            )}
          </div>
        )}
        {r.flag && <div className="mt-1 text-xs font-medium text-clay">Crowd team: {r.flag}</div>}
      </td>
      <td className="cell">
        <div className="font-mono text-xs">{orDash(r.idNumber)}</div>
        {r.idType && (
          <div className="mt-0.5 inline-block rounded bg-ink/10 px-1.5 py-0.5 text-[11px] font-medium text-ink/75">
            {ID_TYPE_LABEL[r.idType]}
          </div>
        )}
      </td>
      <td className="cell whitespace-nowrap">{r.nationality ? nationalityLabel(r.nationality) : '—'}</td>
      <td className="cell whitespace-nowrap">
        {r.tourDate ? formatTourDate(r.tourDate) : '—'}
        {r.departureTime && <div className="text-xs text-ink/60">{r.departureTime}</div>}
      </td>
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
          {can(admin.role, 'deleteRegistrations') && (
            <button className="btn-danger btn-sm" disabled={busy === r.id} onClick={() => onDelete(r)}>
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function Section({ trip, counts, mismatch, rows, admin, run, busy, open, onToggle, onExport, onDelete, mailStatuses }: {
  trip: Trip; counts: TripCounts; mismatch?: { counted: number; stored: number };
  rows: Registration[]; admin: Admin;
  run: ReturnType<typeof useRunner>['run']; busy: string | null;
  open: boolean; onToggle: () => void;
  onExport: () => void; onDelete: (r: Registration) => void;
  mailStatuses: Map<string, MailStatus>;
}) {
  const panelId = `trip-${slug(trip.key)}`;
  const exportKey = `export:${trip.key}`;
  return (
    <section className="rounded-md border border-ink/10 bg-white" data-trip={trip.key}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-ink/10 p-3 sm:p-4">
        <button
          type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle}
          className="flex min-h-[44px] flex-1 items-center gap-2 rounded text-left"
        >
          <span aria-hidden className={`text-ink/50 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          <SlotMark slot={trip.slot} />
          <span>
            <span className="block font-semibold">{trip.tourName}</span>
            <span className="block text-xs text-ink/70">
              {formatTourDate(trip.date)} · {trip.departureTime || '—'} · {trip.pickupPoint}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-4">
          <Counts counts={counts} mismatch={mismatch} />
          {can(admin.role, 'manageRegistrations') && (
            <button className="btn-ghost btn-sm" disabled={!rows.length || busy === exportKey} onClick={onExport}>
              {busy === exportKey ? 'Preparing…' : `Save / Export (${rows.length})`}
            </button>
          )}
        </div>
      </div>

      {trip.tour && (
        <div className="px-3 pt-3 sm:px-4">
          <TourNoticesInline tour={trip.tour} />
        </div>
      )}

      {open && (
        <div id={panelId} className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-ink/70">No visitors in this trip yet.</p>
          ) : (
            <table className="w-full min-w-[980px] text-sm">
              <thead className="table-head"><tr>
                <th className="cell">Code</th><th className="cell">Visitor</th><th className="cell">ID / Passport</th>
                <th className="cell">Nationality</th><th className="cell">Date</th>
                <th className="cell">Status</th><th className="cell text-right">Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.id} reg={r} admin={admin} run={run} busy={busy} onDelete={onDelete}
                    mail={r.mailId ? mailStatuses.get(r.mailId) : undefined} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

export default function RegistrationsPage() {
  const { admin } = useAuth();
  const { data: tours } = useTours();
  const { data: regs, loading, error } = useRegistrations();
  const { run, busy, error: actionError, clearError } = useRunner();
  const mailStatuses = useMailStatuses();
  const [tourId, setTourId] = useState('');
  const [status, setStatusFilter] = useState<Filter>('');
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Registration | null>(null);
  const [notice, setNotice] = useState('');

  const filtering = !!(q || tourId || status);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return regs
      .filter((r) => !tourId || r.tourId === tourId)
      .filter((r) => !status || (status === 'flagged' ? !!r.flag : r.status === status))
      .filter((r) => !s || [r.id, r.name, r.email, r.phone, r.idNumber]
        .some((v) => (v ?? '').toLowerCase().includes(s)));
  }, [regs, tourId, status, q]);

  const trips = useMemo(() => buildTrips(tours, regs), [tours, regs]);
  const allByTrip = useMemo(() => groupByTrip(regs, tours), [regs, tours]);
  const rowsByTrip = useMemo(() => groupByTrip(rows, tours), [rows, tours]);
  // Seat-counter drift is a data problem, so only the people who can fix it are told.
  const mismatches = useMemo(
    () => (can(admin?.role, 'manageTours') ? countMismatches(tours, regs) : new Map()),
    [tours, regs, admin?.role]
  );

  // Everything is open by default; `collapsed` only ever holds what was closed by hand.
  const sections = useMemo(
    () => trips
      .map((trip) => ({
        trip,
        counts: tripCounts(allByTrip.get(trip.key) ?? [], trip.capacity),
        rows: flaggedFirst(rowsByTrip.get(trip.key) ?? []),
      }))
      // While filtering, a section with no matches is just noise.
      .filter((s) => !filtering || s.rows.length > 0),
    [trips, allByTrip, rowsByTrip, filtering]
  );

  if (!admin) return null;
  const pendingCount = regs.filter((r) => r.status === 'pending').length;
  const flaggedCount = regs.filter((r) => r.flag && r.status !== 'cancelled').length;
  const canExport = can(admin.role, 'manageRegistrations');

  /** One sheet, or one per trip plus a Summary. exceljs is fetched on the first click. */
  function exportSheets(key: string, sheets: TripSheet[], fileName: string, what: string) {
    run(key, async () => {
      const count = await exportTrips(sheets, fileName);
      await logRegistrationsExport(admin!, `${what} · ${count} row${count === 1 ? '' : 's'} · ${fileName}`);
      setNotice(`Exported ${count} participant${count === 1 ? '' : 's'} to ${fileName}`);
    });
  }

  const exportAll = () => exportSheets(
    'export:all',
    sections.filter((s) => s.rows.length).map(({ trip, rows: r }) => ({ trip, rows: r })),
    `all-registrations_${stamp()}.xlsx`,
    filtering ? 'filtered view' : 'all trips'
  );

  function confirmDelete() {
    const r = deleting;
    if (!r) return;
    run(r.id, async () => {
      await deleteRegistration(r, admin!);
      setDeleting(null);
      setNotice(`Registration deleted — ${r.name} (${r.id}).`);
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Registrations</h1>
          <p className="mt-1 text-sm text-ink/70">
            One section per destination, date and departure time. {pendingCount} waiting for review
            {flaggedCount > 0 && <>, <span className="font-medium text-clay">{flaggedCount} flagged</span></>}.
          </p>
        </div>
        {canExport && (
          <button className="btn-ghost" disabled={!rows.length || busy === 'export:all'} onClick={exportAll}>
            {busy === 'export:all' ? 'Preparing…' : `Export all (Excel) (${rows.length})`}
          </button>
        )}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-[1fr,auto,auto]">
        <div>
          <label htmlFor="q" className="sr-only">Search</label>
          <input id="q" type="search" className="input" placeholder="Search code, name, email, phone or passport"
            value={q} onChange={(e) => setQ(e.target.value)} />
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

      <div className="mt-3 flex gap-2">
        <button className="btn-ghost btn-sm" onClick={() => setCollapsed(new Set())}>Expand all</button>
        <button className="btn-ghost btn-sm" onClick={() => setCollapsed(new Set(sections.map((s) => s.trip.key)))}>
          Collapse all
        </button>
      </div>

      <ErrorNote message={error} />
      <ErrorNote message={actionError} onClose={clearError} />
      <SuccessNote message={notice} onClose={() => setNotice('')} />

      <div className="mt-4 space-y-4">
        {sections.map(({ trip, counts, rows: sectionRows }) => (
          <Section
            key={trip.key} trip={trip} counts={counts} rows={sectionRows}
            mismatch={mismatches.get(trip.tourId)}
            admin={admin} run={run} busy={busy} mailStatuses={mailStatuses}
            open={!collapsed.has(trip.key)}
            onToggle={() => setCollapsed((c) => {
              const next = new Set(c);
              if (!next.delete(trip.key)) next.add(trip.key);
              return next;
            })}
            onExport={() => exportSheets(
              `export:${trip.key}`,
              [{ trip, rows: sectionRows }],
              tripFileName(trip),
              `${trip.tourName} · ${trip.date || 'no date'} · ${trip.departureTime}`
            )}
            onDelete={setDeleting}
          />
        ))}
      </div>

      {loading && <p className="p-4 text-ink/70" role="status">Loading…</p>}
      {!loading && sections.length === 0 && (
        <p className="mt-4 rounded-md border border-dashed border-ink/20 p-6 text-ink/70">
          {filtering
            ? 'No registrations match. Clear the search or change the filters.'
            : 'No tours or registrations yet. Add a tour, then share the registration page link with visitors.'}
        </p>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete this registration?"
        description="This permanently deletes the registration and can't be undone."
        details={deleting ? [
          ['Name', deleting.name],
          ['Code', deleting.id],
          [deleting.idType ? ID_TYPE_LABEL[deleting.idType] : 'ID', orDash(deleting.idNumber)],
          ['Tour', deleting.tourName],
          ['Date', deleting.tourDate ? formatTourDate(deleting.tourDate) : '—'],
          ['Departure time', orDash(deleting.departureTime)],
        ] : undefined}
        confirmLabel="Delete registration"
        cancelLabel="Keep it"
        busy={!!deleting && busy === deleting.id}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
