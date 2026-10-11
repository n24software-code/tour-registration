import type { Tour } from '@/lib/types';

export type NoticeTour = Pick<Tour, 'experienceDuration' | 'notices'>;

export const hasTripInfo = (t?: NoticeTour | null) =>
  !!(t && (t.experienceDuration || t.notices?.length));

/**
 * "Before you book": the duration first, then the conditions. Only rendered for a tour
 * that actually carries this information — the data lives on the tour document, so no
 * tour is special-cased in code.
 */
export function TourNotices({ tour, heading = 'Before you book', id }: {
  tour: NoticeTour;
  heading?: string;
  id?: string;
}) {
  if (!hasTripInfo(tour)) return null;
  return (
    <div id={id} className="rounded-md border border-sun/60 bg-sun/10 p-4">
      <h3 className="text-base font-semibold">{heading}</h3>
      {tour.experienceDuration && (
        <p className="mt-2 text-sm">
          <span className="font-medium">Experience duration:</span> {tour.experienceDuration}
        </p>
      )}
      {!!tour.notices?.length && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {tour.notices.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

/** The same information, flattened for admin lists where a panel would be too loud. */
export function TourNoticesInline({ tour }: { tour: NoticeTour }) {
  if (!hasTripInfo(tour)) return null;
  return (
    <div className="mt-2 rounded border border-sun/50 bg-sun/10 px-3 py-2 text-xs">
      {tour.experienceDuration && (
        <p><span className="font-medium">Duration:</span> {tour.experienceDuration}</p>
      )}
      {!!tour.notices?.length && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {tour.notices.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}
