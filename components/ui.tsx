import type { Slot, Status } from '@/lib/types';
import { SLOT_NAME, STATUS_LABEL } from '@/lib/types';
import { batchLabel, formatDate, formatTourDate, orDash, tourTitle } from '@/lib/format';
import { seatsLeft } from '@/lib/seats';

// Re-exported so components keep importing their formatting from one place.
export { formatDate, formatTourDate, orDash, tourTitle, batchLabel, seatsLeft };

const STATUS_STYLE: Record<Status, string> = {
  pending: 'bg-ink/10 text-ink',
  confirmed: 'bg-dusk/15 text-dusk',
  checked_in: 'bg-sun/25 text-[#6b4409]',
  boarded: 'bg-palm text-white',
  no_show: 'bg-clay/15 text-clay',
  cancelled: 'bg-clay text-white',
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Sun for morning, crescent moon for evening. */
export function SlotMark({ slot, className = 'h-4 w-4' }: { slot: Slot; className?: string }) {
  return slot === 'morning' ? (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 text-sun`} aria-label={SLOT_NAME.morning} role="img">
      <circle cx="12" cy="12" r="5" fill="currentColor" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1="12" y1="2.5" x2="12" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 text-dusk`} aria-label={SLOT_NAME.evening} role="img">
      <path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.9A7 7 0 0 1 15.5 3.5Z" fill="currentColor" />
    </svg>
  );
}

export function ErrorNote({ message, onClose }: { message: string; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="mt-4 flex items-start gap-3 rounded-md bg-clay/10 px-4 py-3 text-sm text-clay">
      <span className="flex-1">{message}</span>
      {onClose && <button type="button" className="font-medium underline" onClick={onClose}>Dismiss</button>}
    </div>
  );
}

/** The quiet counterpart to ErrorNote: announced politely, dismissible. */
export function SuccessNote({ message, onClose }: { message: string; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="status" className="mt-4 flex items-start gap-3 rounded-md bg-palm/10 px-4 py-3 text-sm text-palm">
      <span className="flex-1">{message}</span>
      {onClose && <button type="button" className="font-medium underline" onClick={onClose}>Dismiss</button>}
    </div>
  );
}

/**
 * One line that names a trip, e.g.
 * "08:00 · Sat, 15 Nov 2026 · SABIC - Home of Innovation – Batch 1".
 */
export const tripLabel = (t: {
  departureTime: string; date: string; tourName: string; batch?: number | null;
}) =>
  `${t.departureTime} · ${formatTourDate(t.date)} · ${t.tourName}`
  + (t.batch ? ` – Batch ${t.batch}` : '');
