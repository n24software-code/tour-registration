'use client';
/**
 * Excel (.xlsx) export for the trip lists.
 *
 * exceljs is ~250 kB, so it is pulled in with a dynamic import() the first time someone
 * presses a Save / Export button — it never reaches the page bundle. (The npm `xlsx`
 * package is deliberately not used: it carries unpatched advisories.)
 */
import { nationalityLabel } from './nationalities';
import { tripCounts, type Trip } from './trips';
import { STATUS_LABEL, type Registration } from './types';

export interface TripSheet {
  trip: Trip;
  /** Every row in the trip, cancelled ones included — they are labelled, not hidden. */
  rows: Registration[];
}

const COLUMNS = [
  { header: 'Code', width: 10 },
  { header: 'Full name', width: 26 },
  { header: 'Mobile', width: 16 },
  { header: 'Passport number', width: 18 },
  { header: 'Nationality', width: 16 },
  { header: 'Email', width: 28 },
  { header: 'Tour', width: 30 },
  { header: 'Date', width: 12 },
  { header: 'Departure time', width: 14 },
  { header: 'Pickup point', width: 22 },
  { header: 'Status', width: 14 },
  { header: 'Bus', width: 7 },
  { header: 'Flag', width: 30 },
  { header: 'Registered at', width: 18 },
] as const;

/** Columns that must stay literal text: leading zeros and a leading "+" have to survive. */
const TEXT_COLUMNS = [3, 4]; // Mobile, Passport number (1-based)
const DATE_COLUMN = 8;
const TIMESTAMP_COLUMN = 14;

const INK = 'FF1A2238';
const PAPER = 'FFF5F6F2';
const CLAY = 'FFB4412F';

/**
 * Guards against spreadsheet formula injection.
 *
 * exceljs writes a plain string as a string cell, which Excel never evaluates, but a
 * leading =, +, - or @ is still prefixed so the text stays inert if the sheet is ever
 * re-saved as CSV or pasted into a formula bar. The Mobile and Passport columns are
 * exempt: they are forced to the text format, and a phone's leading "+" is meaningful.
 */
const guard = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v);

const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/**
 * Excel wants a real date; "2026-10-16" is parsed as UTC midnight to avoid drifting a day.
 * A trip with no fixed date — and a legacy registration with no tourDate — leaves the cell
 * genuinely empty rather than putting a string in a date column, so sorting still works.
 */
const excelDate = (iso?: string): Date | null => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Only characters that are safe in a filename on every platform. */
const safeName = (s: string) =>
  s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60)
  || 'registrations';

/** `<tour-name>_<YYYY-MM-DD>_<HHmm>.xlsx`, the date and time being the trip's own. */
export function tripFileName(trip: Trip) {
  const date = trip.date || 'no-date';
  const time = (trip.departureTime || '0000').replace(':', '');
  return `${safeName(trip.tourName)}_${date}_${time}.xlsx`;
}

/** Excel caps sheet names at 31 chars and forbids : \ / ? * [ ]. */
function sheetName(trip: Trip, taken: Set<string>) {
  const base = `${trip.departureTime.replace(':', '')} ${trip.tourName}`
    .replace(/[:\\/?*[\]]/g, '-').slice(0, 28).trim() || 'Trip';
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 27)} ${i}`;
  taken.add(name);
  return name;
}

function addTripSheet(wb: import('exceljs').Workbook, { trip, rows }: TripSheet, taken: Set<string>) {
  const ws = wb.addWorksheet(sheetName(trip, taken), {
    views: [{ state: 'frozen', ySplit: 2 }], // title row + header row
  });
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));

  // --- title row -----------------------------------------------------------
  const title = ws.addRow([
    `${trip.tourName} · ${trip.date || 'No fixed date'} · ${trip.departureTime || '—'} · ${trip.pickupPoint}`,
  ]);
  ws.mergeCells(1, 1, 1, COLUMNS.length);
  title.font = { bold: true, size: 13, color: { argb: INK } };
  title.alignment = { vertical: 'middle' };
  title.height = 22;

  // --- header row ----------------------------------------------------------
  const head = ws.addRow(COLUMNS.map((c) => c.header));
  head.font = { bold: true, color: { argb: INK } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } };
  head.border = { bottom: { style: 'thin', color: { argb: INK } } };

  // --- data ----------------------------------------------------------------
  for (const r of rows) {
    const row = ws.addRow([
      guard(r.id),
      guard(cell(r.name)),
      cell(r.phone),                                   // text column, left verbatim
      cell(r.passportNumber),                          // text column, left verbatim
      guard(r.nationality ? nationalityLabel(r.nationality) : ''),
      guard(cell(r.email)),
      guard(cell(r.tourName)),
      excelDate(r.tourDate),
      guard(cell(r.departureTime)),
      guard(cell(trip.pickupPoint)),
      STATUS_LABEL[r.status],
      guard(cell(r.busNumber)),
      guard(cell(r.flag)),
      r.createdAt?.toDate() ?? null,
    ]);
    for (const i of TEXT_COLUMNS) row.getCell(i).numFmt = '@';
    row.getCell(DATE_COLUMN).numFmt = 'yyyy-mm-dd';
    row.getCell(TIMESTAMP_COLUMN).numFmt = 'yyyy-mm-dd hh:mm';
    // Cancelled rows stay in the file but are unmistakable.
    if (r.status === 'cancelled') {
      row.font = { color: { argb: CLAY }, italic: true };
      row.getCell(11).font = { color: { argb: CLAY }, bold: true, italic: true };
    }
  }

  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2 + rows.length, column: COLUMNS.length },
  };
  return ws;
}

const SUMMARY_COLUMNS = [
  { header: 'Tour', width: 32 },
  { header: 'Date', width: 12 },
  { header: 'Departure time', width: 14 },
  { header: 'Pickup point', width: 22 },
  { header: 'Capacity', width: 10 },
  { header: 'Registered', width: 11 },
  { header: 'Seats left', width: 11 },
  { header: 'Pending', width: 9 },
  { header: 'Confirmed', width: 11 },
  { header: 'At pickup', width: 10 },
  { header: 'On bus', width: 9 },
  { header: 'No-show', width: 9 },
  { header: 'Cancelled', width: 10 },
  { header: 'Flagged', width: 9 },
] as const;

function addSummarySheet(wb: import('exceljs').Workbook, sheets: TripSheet[]) {
  // First sheet in the book, so it is what opens.
  const ws = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.columns = SUMMARY_COLUMNS.map((c) => ({ width: c.width }));

  const title = ws.addRow([`Registrations by trip · exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`]);
  ws.mergeCells(1, 1, 1, SUMMARY_COLUMNS.length);
  title.font = { bold: true, size: 13, color: { argb: INK } };
  title.height = 22;

  const head = ws.addRow(SUMMARY_COLUMNS.map((c) => c.header));
  head.font = { bold: true, color: { argb: INK } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } };
  head.border = { bottom: { style: 'thin', color: { argb: INK } } };

  for (const { trip, rows } of sheets) {
    const c = tripCounts(rows, trip.capacity);
    const row = ws.addRow([
      guard(trip.tourName), excelDate(trip.date), guard(trip.departureTime), guard(trip.pickupPoint),
      c.capacity, c.registered, c.seatsLeft,
      c.pending, c.confirmed, c.checkedIn, c.boarded, c.noShow, c.cancelled, c.flagged,
    ]);
    row.getCell(2).numFmt = 'yyyy-mm-dd';
  }

  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2 + sheets.length, column: SUMMARY_COLUMNS.length },
  };
  return ws;
}

function save(buffer: ArrayBuffer, fileName: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Builds and downloads the workbook. One sheet per trip; with more than one trip a
 * "Summary" sheet goes first. Returns the number of participant rows written, for the
 * audit entry.
 */
export async function exportTrips(sheets: TripSheet[], fileName: string) {
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  wb.creator = 'Tour operations';
  wb.created = new Date();

  if (sheets.length > 1) addSummarySheet(wb, sheets);
  const taken = new Set<string>();
  for (const s of sheets) addTripSheet(wb, s, taken);

  const buffer = await wb.xlsx.writeBuffer();
  save(buffer as ArrayBuffer, fileName);
  return sheets.reduce((n, s) => n + s.rows.length, 0);
}
