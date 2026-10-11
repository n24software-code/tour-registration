/**
 * The trip lists download as real .xlsx files. Every assertion here parses the
 * downloaded workbook with exceljs rather than trusting the file name.
 */
import { expect, test, type Page } from '@playwright/test';
import { Workbook, type Worksheet } from 'exceljs';
import {
  TOUR_IDS, adminDb, dayAfter, getReg, getTour, patchTour, registerVisitor, signIn,
  testEmail, testPassport, type Role,
} from './helpers';

const TOUR = TOUR_IDS.kapsarc;
// Dates 30+ days out: each spec owns its own window so per-section counts can't collide.


const HEADERS = [
  'Code', 'Full name', 'Mobile', 'ID type', 'ID number', 'Nationality', 'Email',
  'Tour', 'Date', 'Departure time', 'Pickup point', 'Status', 'Bus', 'Flag', 'Registered at',
];

const SUMMARY_HEADERS = [
  'Tour', 'Date', 'Departure time', 'Pickup point', 'Capacity', 'Registered', 'Seats left',
  'Pending', 'Confirmed', 'At pickup', 'On bus', 'No-show', 'Cancelled', 'Flagged',
];

/** Mirrors formatDate() in components/ui.tsx. */
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
});

const section = (page: Page, tourName: string, date: string) =>
  page.locator('section').filter({ hasText: tourName }).filter({ hasText: longDate(date) });

/** Downloads whatever the click triggers and parses it as a workbook. */
async function downloadWorkbook(page: Page, click: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await download.path();
  const wb = new Workbook();
  await wb.xlsx.readFile(path!);
  return { wb, name: download.suggestedFilename() };
}

const headerRow = (ws: Worksheet) =>
  (ws.getRow(2).values as unknown[]).slice(1).map((v) => String(v ?? ''));

/** Data rows start at 3: row 1 is the title, row 2 the header. */
const dataRows = (ws: Worksheet) => {
  const out: Record<string, unknown>[] = [];
  for (let i = 3; i <= ws.rowCount; i++) {
    const values = (ws.getRow(i).values as unknown[]).slice(1);
    if (values.every((v) => v === undefined || v === null || v === '')) continue;
    out.push(Object.fromEntries(HEADERS.map((h, j) => [h, values[j]])));
  }
  return out;
};

test.describe('Excel export', () => {
  test.beforeEach(async () => { await patchTour(TOUR, { date: '' }); });

  test('a section exports a real .xlsx with the documented columns and rows', async ({ page }) => {
    const date = dayAfter(30);
    const tour = await getTour(TOUR);
    const passport = testPassport();
    const email = testEmail();

    const a = await registerVisitor(page, {
      name: 'Excel One', tourId: TOUR, date, idNumber: passport, email,
      phone: '0501234567', phoneCountry: 'SA', nationality: 'Egyptian',
    });
    const b = await registerVisitor(page, { name: 'Excel Two', tourId: TOUR, date });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');
    const mine = section(page, tour.name, date);
    await expect(mine).toBeVisible({ timeout: 20_000 });

    const { wb, name } = await downloadWorkbook(page, () =>
      mine.getByRole('button', { name: /Save \/ Export/ }).click());

    // <tour-name>_<YYYY-MM-DD>_<HHmm>.xlsx, safe characters only.
    expect(name).toMatch(/^[\w-]+_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);
    expect(name).toContain(date);
    expect(name).toContain(tour.departureTime.replace(':', ''));

    // One sheet for one trip — no Summary needed.
    expect(wb.worksheets).toHaveLength(1);
    const ws = wb.worksheets[0];

    // Title row names the trip; header row is bold and frozen.
    expect(String(ws.getCell('A1').value)).toContain(tour.name);
    expect(String(ws.getCell('A1').value)).toContain(date);
    expect(headerRow(ws)).toEqual(HEADERS);
    expect(ws.getRow(2).font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 2 });
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.columns.every((c) => (c.width ?? 0) > 0)).toBe(true);

    // The row count matches the section.
    const rows = dataRows(ws);
    const visible = await mine.locator('tbody tr').count();
    expect(rows).toHaveLength(visible);
    expect(rows.map((r) => r.Code)).toEqual(expect.arrayContaining([a, b]));

    const one = rows.find((r) => r.Code === a)!;
    // The number is readable and still text, so no leading zero or "+" is lost.
    expect(one.Mobile).toBe('+966 50 123 4567');
    expect(typeof one.Mobile).toBe('string');
    expect(one['ID type']).toBe('Passport');
    expect(one['ID number']).toBe(passport);
    expect(typeof one['ID number']).toBe('string');
    expect(one.Nationality).toBe('Egyptian');
    expect(one.Email).toBe(email);
    expect(one['Pickup point']).toBe(tour.pickupPoint);
    expect(one.Status).toBe('Pending review');
    // The date is a real Excel date, not a string.
    expect(one.Date).toBeInstanceOf(Date);
    expect((one.Date as Date).toISOString().slice(0, 10)).toBe(date);
    expect(one['Registered at']).toBeInstanceOf(Date);

    // Phone and ID number carry the text number format.
    const dataRow = ws.getRow(3);
    expect(dataRow.getCell(3).numFmt).toBe('@');  // Mobile
    expect(dataRow.getCell(5).numFmt).toBe('@');  // ID number
  });

  test('Export all writes one sheet per trip plus a Summary whose totals match', async ({ page }) => {
    const dayOne = dayAfter(31);
    const dayTwo = dayAfter(32);
    const tour = await getTour(TOUR);

    const one = await registerVisitor(page, { name: 'Summary A', tourId: TOUR, date: dayOne });
    const two = await registerVisitor(page, { name: 'Summary B', tourId: TOUR, date: dayOne });
    const three = await registerVisitor(page, { name: 'Summary C', tourId: TOUR, date: dayTwo });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');
    // Narrow to this tour so the workbook is predictable.
    await page.getByLabel('Tour').selectOption(TOUR);
    await expect(section(page, tour.name, dayOne)).toBeVisible({ timeout: 20_000 });

    const { wb, name } = await downloadWorkbook(page, () =>
      page.getByRole('button', { name: /Export all \(Excel\)/ }).click());
    expect(name).toMatch(/^all-registrations_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);

    // Summary first, then one sheet per trip.
    const summary = wb.getWorksheet('Summary')!;
    expect(summary).toBeTruthy();
    expect(wb.worksheets[0].name).toBe('Summary');
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(3); // Summary + 2 trips
    expect((summary.getRow(2).values as unknown[]).slice(1).map(String)).toEqual(SUMMARY_HEADERS);

    // Each Summary row's Registered equals the non-cancelled rows on that trip's sheet.
    // Sheets are matched by the title row, because a trip may legitimately have no date
    // (the tour has none, or the rows predate the tourDate field) and then the Date cell
    // is empty — which is exactly what the Date column should hold.
    const tripSheets = wb.worksheets.filter((w) => w.name !== 'Summary');
    let summarised = 0;
    for (let i = 3; i <= summary.rowCount; i++) {
      const v = (summary.getRow(i).values as unknown[]).slice(1);
      if (!v[0]) continue;
      summarised++;
      const [tourName, dateCell, departure] = [String(v[0]), v[1], String(v[2])];
      const registered = Number(v[5]);
      const dateText = dateCell instanceof Date
        ? dateCell.toISOString().slice(0, 10)
        : 'No fixed date';

      const wanted = `${tourName} · ${dateText} · ${departure}`;
      const sheet = tripSheets.find((w) => String(w.getCell('A1').value).startsWith(wanted));
      expect(sheet, `no sheet titled "${wanted}"`).toBeTruthy();

      const notCancelled = dataRows(sheet!).filter((r) => r.Status !== 'Cancelled');
      expect(notCancelled, `Summary says ${registered} registered for ${wanted}`)
        .toHaveLength(registered);
      // Capacity and seats left agree with each other.
      expect(Number(v[4]) - registered).toBe(Number(v[6]));
    }
    expect(summarised).toBe(tripSheets.length);

    // The three visitors we registered are all somewhere in the book.
    const everyCode = tripSheets.flatMap((w) => dataRows(w).map((r) => r.Code));
    expect(everyCode).toEqual(expect.arrayContaining([one, two, three]));
  });

  test('cancelled rows are included, labelled, and left out of the counts', async ({ page }) => {
    const date = dayAfter(33);
    const tour = await getTour(TOUR);
    const keep = await registerVisitor(page, { name: 'Excel Keep', tourId: TOUR, date });
    const gone = await registerVisitor(page, { name: 'Excel Cancelled', tourId: TOUR, date });

    await signIn(page, 'po');
    await page.goto('/admin/registrations');
    const mine = section(page, tour.name, date);
    await expect(mine).toBeVisible({ timeout: 20_000 });

    page.once('dialog', (d) => d.accept());
    await mine.locator('tr', { hasText: gone }).getByRole('button', { name: 'Cancel' }).click();
    await expect(mine.locator('tr', { hasText: gone })).toContainText('Cancelled');
    // The export reads what the live listener holds, so wait for the write to land.
    await expect.poll(async () => (await getReg(gone))?.status, { timeout: 20_000 }).toBe('cancelled');
    await expect(mine.getByText(/^Cancelled 1$/)).toBeVisible();

    const { wb } = await downloadWorkbook(page, () =>
      mine.getByRole('button', { name: /Save \/ Export/ }).click());
    const rows = dataRows(wb.worksheets[0]);

    // Both are in the file...
    expect(rows.map((r) => r.Code)).toEqual(expect.arrayContaining([keep, gone]));
    // ...the cancelled one is labelled...
    expect(rows.find((r) => r.Code === gone)!.Status).toBe('Cancelled');
    // ...and the section heading counts only the other one.
    await expect(mine.getByText(/^1 registered/)).toBeVisible();
  });

  test('a formula-like name is neutralised', async ({ page }) => {
    const date = dayAfter(34);
    const tour = await getTour(TOUR);
    const code = await registerVisitor(page, {
      name: '=cmd|calc Attack', tourId: TOUR, date,
    });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');
    const mine = section(page, tour.name, date);
    await expect(mine).toBeVisible({ timeout: 20_000 });

    const { wb } = await downloadWorkbook(page, () =>
      mine.getByRole('button', { name: /Save \/ Export/ }).click());
    const row = dataRows(wb.worksheets[0]).find((r) => r.Code === code)!;
    expect(String(row['Full name']).startsWith("'=")).toBe(true);
    // And it is text, never a formula.
    expect(typeof row['Full name']).toBe('string');
  });

  test('exporting writes an audit entry naming the trip and the row count', async ({ page }) => {
    const date = dayAfter(35);
    const tour = await getTour(TOUR);
    const code = await registerVisitor(page, { name: 'Excel Audited', tourId: TOUR, date });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');
    const mine = section(page, tour.name, date);
    await expect(mine).toBeVisible({ timeout: 20_000 });

    await downloadWorkbook(page, () => mine.getByRole('button', { name: /Save \/ Export/ }).click());
    await expect(page.getByRole('status')).toContainText('Exported 1 participant');

    await expect.poll(async () => {
      const snap = await adminDb().collection('auditLogs')
        .where('action', '==', 'registrations:export').get();
      return snap.docs
        .map((d) => String(d.data().detail ?? ''))
        .filter((detail) => detail.includes(date) && detail.includes(tour.name) && detail.includes('1 row'));
    }, { timeout: 20_000 }).not.toHaveLength(0);

    // The exported row really is the one we registered.
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
  });

  for (const role of ['pm', 'registration'] as Role[]) {
    test(`${role} can export`, async ({ page }) => {
      const date = dayAfter(36);
      const tour = await getTour(TOUR);
      await registerVisitor(page, { name: `Export By ${role}`, tourId: TOUR, date });

      await signIn(page, role);
      await page.goto('/admin/registrations');
      const mine = section(page, tour.name, date);
      await expect(mine).toBeVisible({ timeout: 20_000 });
      await expect(mine.getByRole('button', { name: /Save \/ Export/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Export all \(Excel\)/ })).toBeVisible();
    });
  }

  test('the Crowd team never sees an export button', async ({ page }) => {
    await signIn(page, 'crowd');
    await page.goto('/admin/registrations');
    // They cannot open the page at all, let alone export from it.
    await expect(page.getByRole('heading', { name: /isn’t available to your role/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Save \/ Export/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Export all/ })).toHaveCount(0);

    await page.goto('/admin/crowd');
    await expect(page.getByRole('button', { name: /Save \/ Export|Export all/ })).toHaveCount(0);
  });
});
