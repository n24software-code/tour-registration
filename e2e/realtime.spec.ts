import { expect, test, type Browser, type Page } from '@playwright/test';
import { Workbook } from 'exceljs';
import {
  CREDS, TOUR_IDS, dayAfter, getReg, getTour, patchTour, registerVisitor, signIn,
  testEmail, testPassport, waitForAudit, auditFor,
} from './helpers';

const TOUR = TOUR_IDS.kapsarc;
/** Everything in this file rides on one trip, so Crowd can pick it from the list. */
const DATE = dayAfter(1);
let TRIP = '';

test.beforeAll(async () => {
  await patchTour(TOUR, { date: '' });
  TRIP = `${TOUR}|${DATE}|${(await getTour(TOUR)).departureTime}`;
});

/** Opens an isolated context so Registration and Crowd are two real browsers. */
async function asRole(browser: Browser, role: 'registration' | 'crowd', url: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, role);
  await page.goto(url);
  return { ctx, page };
}

const crowdCard = (page: Page, code: string) => page.locator('li', { hasText: code });
const regRow = (page: Page, code: string) => page.locator('tr', { hasText: code });

async function selectCrowdTour(page: Page) {
  await page.getByLabel('Trip').selectOption(TRIP);
  await expect(page.getByLabel('Find a visitor')).toBeVisible();
}

test.describe('Registration <-> Crowd in real time', () => {
  test('pending is hidden from Crowd but counted; Confirm pushes the visitor across live', async ({ browser, page }) => {
    const email = testEmail();
    const code = await registerVisitor(page, { name: 'Live Handover', email, tourId: TOUR, date: DATE });

    const crowd = await asRole(browser, 'crowd', '/admin/crowd');
    await selectCrowdTour(crowd.page);

    // Crowd must not see a pending visitor...
    await expect(crowdCard(crowd.page, code)).toHaveCount(0);
    // ...but does see the pending count.
    await expect(crowd.page.getByText(/\d+ more still pending with the Registration team/)).toBeVisible();

    // Registration confirms.
    const reg = await asRole(browser, 'registration', '/admin/registrations');
    await regRow(reg.page, code).getByRole('button', { name: 'Confirm' }).click();

    // ...and the visitor appears on Crowd with no reload.
    await expect(crowdCard(crowd.page, code)).toBeVisible({ timeout: 20_000 });
    await expect(crowdCard(crowd.page, code)).toContainText('Confirmed');
    expect((await getReg(code))?.status).toBe('confirmed');
    await waitForAudit(code, 'status:confirmed');

    await reg.ctx.close();
    await crowd.ctx.close();
  });

  test('Check in, Board bus gated on a bus number, then On the bus + Bus 3', async ({ browser, page }) => {
    const email = testEmail();
    const code = await registerVisitor(page, { name: 'Boarding Flow', email, tourId: TOUR, date: DATE });

    const reg = await asRole(browser, 'registration', '/admin/registrations');
    await regRow(reg.page, code).getByRole('button', { name: 'Confirm' }).click();

    const crowd = await asRole(browser, 'crowd', '/admin/crowd');
    await selectCrowdTour(crowd.page);
    const card = crowdCard(crowd.page, code);
    await expect(card).toBeVisible({ timeout: 20_000 });

    // Check in.
    await card.getByRole('button', { name: 'Check in' }).click();
    await expect(card).toContainText('At pickup');

    // Board is disabled until a bus number is entered.
    const boardDisabled = card.getByRole('button', { name: 'Enter bus number to board' });
    await expect(boardDisabled).toBeVisible();
    await expect(boardDisabled).toBeDisabled();

    await crowd.page.getByLabel('Bus number').fill('3');
    const board = card.getByRole('button', { name: 'Board bus 3' });
    await expect(board).toBeEnabled();
    await board.click();

    await expect(card).toContainText('On the bus');
    await expect(card).toContainText('Bus 3');
    // The card updates from Firestore's local echo before the server acknowledges the
    // write, so the stored values have to be polled rather than read once.
    await expect.poll(async () => (await getReg(code))?.status, { timeout: 20_000 }).toBe('boarded');
    expect((await getReg(code))?.busNumber).toBe('3');
    await waitForAudit(code, 'status:boarded');

    // A boarded visitor has no Cancel button on the Registration page.
    await expect(regRow(reg.page, code)).toContainText('On the bus', { timeout: 20_000 });
    await expect(regRow(reg.page, code).getByRole('button', { name: 'Cancel' })).toHaveCount(0);

    await reg.ctx.close();
    await crowd.ctx.close();
  });

  test('No-show, and Undo from both At pickup and No-show', async ({ browser, page }) => {
    const email = testEmail();
    const code = await registerVisitor(page, { name: 'Undo Paths', email, tourId: TOUR, date: DATE });

    const reg = await asRole(browser, 'registration', '/admin/registrations');
    await regRow(reg.page, code).getByRole('button', { name: 'Confirm' }).click();

    const crowd = await asRole(browser, 'crowd', '/admin/crowd');
    await selectCrowdTour(crowd.page);
    const card = crowdCard(crowd.page, code);
    await expect(card).toBeVisible({ timeout: 20_000 });

    // No-show -> Undo.
    // Don't assert on the text "No-show": the *button* carries that label too, so the
    // badge and the control are indistinguishable. Assert the stored status and the
    // controls the new state offers instead.
    await card.getByRole('button', { name: 'No-show' }).click();
    await expect.poll(async () => (await getReg(code))?.status, { timeout: 20_000 }).toBe('no_show');
    await expect(card.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Check in' })).toHaveCount(0);
    await waitForAudit(code, 'status:no_show');

    await card.getByRole('button', { name: 'Undo' }).click();
    await expect(card).toContainText('Confirmed');
    await expect.poll(async () => (await getReg(code))?.status, { timeout: 20_000 }).toBe('confirmed');
    await waitForAudit(code, 'undo:no_show');

    // At pickup -> Undo.
    await card.getByRole('button', { name: 'Check in' }).click();
    await expect(card).toContainText('At pickup');
    await card.getByRole('button', { name: 'Undo' }).click();
    await expect(card).toContainText('Confirmed');
    await expect.poll(async () => (await getReg(code))?.status, { timeout: 20_000 }).toBe('confirmed');
    await waitForAudit(code, 'undo:checked_in');

    await reg.ctx.close();
    await crowd.ctx.close();
  });

  test('Flag issue surfaces live at the top of the Registration list; filter and Mark resolved clear it', async ({ browser, page }) => {
    // A second, unflagged visitor so we can prove the flagged one sorts first.
    const otherCode = await registerVisitor(page, { name: 'Aaa Unflagged', email: testEmail(), tourId: TOUR, date: DATE });
    const code = await registerVisitor(page, { name: 'Zzz Flagged', email: testEmail(), tourId: TOUR, date: DATE });

    const reg = await asRole(browser, 'registration', '/admin/registrations');
    await regRow(reg.page, otherCode).getByRole('button', { name: 'Confirm' }).click();
    await regRow(reg.page, code).getByRole('button', { name: 'Confirm' }).click();

    const crowd = await asRole(browser, 'crowd', '/admin/crowd');
    await selectCrowdTour(crowd.page);
    const card = crowdCard(crowd.page, code);
    await expect(card).toBeVisible({ timeout: 20_000 });

    const MESSAGE = 'Name does not match ID';
    await card.getByRole('button', { name: 'Flag issue' }).click();
    await card.getByLabel('Message to the Registration team').fill(MESSAGE);
    await card.getByRole('button', { name: 'Send flag' }).click();
    await expect(card).toContainText(`Flagged: ${MESSAGE}`);
    await waitForAudit(code, 'flag:raised');

    // Live on the Registration page, highlighted and sorted to the top.
    const flaggedRow = regRow(reg.page, code);
    await expect(flaggedRow).toContainText(`Crowd team: ${MESSAGE}`, { timeout: 20_000 });
    await expect(reg.page.getByText(/1 flagged|\d+ flagged/)).toBeVisible();
    const mySection = reg.page.locator('section').filter({ hasText: (await getTour(TOUR)).name })
      .filter({ has: reg.page.locator('tr', { hasText: code }) });
    const firstRowText = await mySection.locator('tbody tr').first().innerText();
    expect(firstRowText).toContain(code);

    // The "Flagged by Crowd team" filter narrows to it.
    await reg.page.getByLabel('Status').selectOption('flagged');
    await expect(regRow(reg.page, code)).toBeVisible();
    await expect(regRow(reg.page, otherCode)).toHaveCount(0);

    // Mark resolved clears it on both pages.
    await regRow(reg.page, code).getByRole('button', { name: 'Mark resolved' }).click();
    await expect(regRow(reg.page, code)).toHaveCount(0); // no longer matches the flagged filter
    await reg.page.getByLabel('Status').selectOption('');
    await expect(regRow(reg.page, code)).not.toContainText('Crowd team:');
    await expect(card).not.toContainText('Flagged:', { timeout: 20_000 });
    expect((await getReg(code))?.flag ?? null).toBeNull();
    await waitForAudit(code, 'flag:resolved');

    await reg.ctx.close();
    await crowd.ctx.close();
  });

  test('Cancel releases the seat and removes the visitor from Crowd', async ({ browser, page }) => {
    const email = testEmail();
    const code = await registerVisitor(page, { name: 'Cancel Me', email, tourId: TOUR, date: DATE });

    const reg = await asRole(browser, 'registration', '/admin/registrations');
    await regRow(reg.page, code).getByRole('button', { name: 'Confirm' }).click();

    const crowd = await asRole(browser, 'crowd', '/admin/crowd');
    await selectCrowdTour(crowd.page);
    await expect(crowdCard(crowd.page, code)).toBeVisible({ timeout: 20_000 });

    const countBefore = (await getTour(TOUR)).registeredCount;

    reg.page.once('dialog', (d) => d.accept());
    await regRow(reg.page, code).getByRole('button', { name: 'Cancel' }).click();

    await expect(regRow(reg.page, code)).toContainText('Cancelled');
    await expect.poll(async () => (await getTour(TOUR)).registeredCount, { timeout: 20_000 })
      .toBe(countBefore - 1);
    expect((await getReg(code))?.status).toBe('cancelled');

    // Gone from the Crowd list without a reload.
    await expect(crowdCard(crowd.page, code)).toHaveCount(0, { timeout: 20_000 });
    await waitForAudit(code, 'status:cancelled');

    await reg.ctx.close();
    await crowd.ctx.close();
  });

  test('Overview counts follow each step', async ({ browser, page }) => {
    const code = await registerVisitor(page, { name: 'Counted Visitor', email: testEmail(), tourId: TOUR, date: DATE });

    const po = await asRole(browser, 'registration', '/admin');
    // One row per trip now, so target this trip's row rather than the whole tour.
    const row = po.page.locator(`tr[data-trip="${TRIP}"]`);
    // 0 trip, 1 registered, 2 seats left, 3 pending, 4 confirmed, 5 at pickup, 6 on bus, 7 no-show
    const cell = (i: number) => row.locator('td').nth(i);
    const PENDING = 3, CONFIRMED = 4, AT_PICKUP = 5;

    const pendingBefore = Number(await cell(PENDING).innerText());

    const reg = await asRole(browser, 'registration', '/admin/registrations');
    await regRow(reg.page, code).getByRole('button', { name: 'Confirm' }).click();

    // Pending drops by one, Confirmed rises by one - live.
    await expect.poll(async () => Number(await cell(PENDING).innerText()), { timeout: 20_000 })
      .toBe(pendingBefore - 1);

    const confirmedNow = Number(await cell(CONFIRMED).innerText());
    const crowd = await asRole(browser, 'crowd', '/admin/crowd');
    await selectCrowdTour(crowd.page);
    await crowdCard(crowd.page, code).getByRole('button', { name: 'Check in' }).click();

    await expect.poll(async () => Number(await cell(CONFIRMED).innerText()), { timeout: 20_000 })
      .toBe(confirmedNow - 1);
    await expect.poll(async () => Number(await cell(AT_PICKUP).innerText()), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);

    await po.ctx.close();
    await reg.ctx.close();
    await crowd.ctx.close();
  });

  test('Export all honours the search filter, and the section file names its trip', async ({ browser, page }) => {
    const passport = testPassport();
    const code = await registerVisitor(page, {
      name: 'Export Filtered', email: testEmail(), tourId: TOUR, idNumber: passport,
      nationality: 'Egyptian', date: DATE,
    });

    const reg = await asRole(browser, 'registration', '/admin/registrations');

    // Filter down to this one visitor so we can assert "only the filtered rows".
    await reg.page.getByPlaceholder('Search code, name, email, phone or passport').fill(code);
    await expect(regRow(reg.page, code)).toBeVisible();
    await expect(reg.page.getByRole('button', { name: 'Export all (Excel) (1)' })).toBeVisible();
    await expect(reg.page.locator('section')).toHaveCount(1);

    const [all] = await Promise.all([
      reg.page.waitForEvent('download'),
      reg.page.getByRole('button', { name: /Export all \(Excel\)/ }).click(),
    ]);
    expect(all.suggestedFilename()).toMatch(/^all-registrations_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);

    // One matching row means one trip, so no Summary sheet and exactly one data row.
    const wb = new Workbook();
    await wb.xlsx.readFile((await all.path())!);
    expect(wb.worksheets).toHaveLength(1);
    const ws = wb.worksheets[0];
    const values = (ws.getRow(3).values as unknown[]).slice(1);
    expect(ws.rowCount).toBe(3); // title + header + the one row
    expect(values[0]).toBe(code);
    expect(values[3]).toBe('Passport');   // ID type
    expect(values[4]).toBe(passport);     // ID number
    expect(values[5]).toBe('Egyptian');

    // The section's own button names the trip it came from.
    const [sectionFile] = await Promise.all([
      reg.page.waitForEvent('download'),
      reg.page.locator('section').getByRole('button', { name: /Save \/ Export/ }).first().click(),
    ]);
    expect(sectionFile.suggestedFilename()).toContain(DATE);

    await reg.ctx.close();
  });

  test('every audit entry carries the acting uid and role', async ({ browser, page }) => {
    const code = await registerVisitor(page, { name: 'Audit Subject', email: testEmail(), tourId: TOUR, date: DATE });

    const reg = await asRole(browser, 'registration', '/admin/registrations');
    await regRow(reg.page, code).getByRole('button', { name: 'Confirm' }).click();
    const confirmEntry = await waitForAudit(code, 'status:confirmed');
    expect(confirmEntry.byRole).toBe('registration');
    expect(confirmEntry.byEmail).toBe(CREDS.registration.email);
    expect(confirmEntry.byUid).toBeTruthy();

    const crowd = await asRole(browser, 'crowd', '/admin/crowd');
    await selectCrowdTour(crowd.page);
    await crowdCard(crowd.page, code).getByRole('button', { name: 'Check in' }).click();
    const checkIn = await waitForAudit(code, 'status:checked_in');
    expect(checkIn.byRole).toBe('crowd');
    expect(checkIn.byEmail).toBe(CREDS.crowd.email);

    // Both acts are on the same registration and nothing else leaked in.
    const all = await auditFor(code);
    expect(all.every((e) => e.regId === code)).toBe(true);

    await reg.ctx.close();
    await crowd.ctx.close();
  });
});
