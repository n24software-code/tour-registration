/**
 * The Registrations page is now one collapsible section per trip
 * (destination + date + departure time), and the Product Owner — and only the
 * Product Owner — can delete a registration outright.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  TOUR_IDS, adminDb, auditFor, clientAs, dayAfter, getReg, getTour, patchTour,
  registerVisitor, signIn, testPassport, waitForAudit, type Role,
} from './helpers';

const TOUR = TOUR_IDS.kapsarc;
// Dates 50+ days out: each spec owns its own window so per-section counts can't collide.


const section = (page: Page, tourName: string, date: string) =>
  page.locator('section').filter({ hasText: tourName }).filter({ hasText: longDate(date) });

/** Mirrors formatDate() in components/ui.tsx. */
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
});

const row = (page: Page, code: string) => page.locator('tr', { hasText: code });

test.describe('Registrations: grouped sections', () => {
  test.beforeEach(async () => { await patchTour(TOUR, { date: '' }); });

  test('visitors land in a section per destination + date + time, with live counts', async ({ page }) => {
    const dayOne = dayAfter(50);
    const dayTwo = dayAfter(51);
    const tour = await getTour(TOUR);

    const a = await registerVisitor(page, { name: 'Group Day One A', tourId: TOUR, date: dayOne });
    const b = await registerVisitor(page, { name: 'Group Day One B', tourId: TOUR, date: dayOne });
    const c = await registerVisitor(page, { name: 'Group Day Two', tourId: TOUR, date: dayTwo });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');

    const first = section(page, tour.name, dayOne);
    const second = section(page, tour.name, dayTwo);
    await expect(first).toBeVisible({ timeout: 20_000 });
    await expect(second).toBeVisible();

    // Each heading names the date, the departure time and the pickup point.
    await expect(first).toContainText(tour.departureTime);
    await expect(first).toContainText(tour.pickupPoint);

    // Rows sit in the right section and nowhere else.
    await expect(first.locator('tr', { hasText: a })).toHaveCount(1);
    await expect(first.locator('tr', { hasText: b })).toHaveCount(1);
    await expect(first.locator('tr', { hasText: c })).toHaveCount(0);
    await expect(second.locator('tr', { hasText: c })).toHaveCount(1);

    // The counts belong to the trip, not to the whole tour.
    await expect(first.getByText(/^Pending 2$/)).toBeVisible();
    await expect(second.getByText(/^Pending 1$/)).toBeVisible();
    await expect(first.getByText(
      `2 registered · ${tour.capacity - 2} seats left (${tour.capacity})`
    )).toBeVisible();

    // Confirming one moves it between the counters, live.
    await first.locator('tr', { hasText: a }).getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(first.getByText(/^Pending 1$/)).toBeVisible({ timeout: 20_000 });
    await expect(first.getByText(/^Confirmed 1$/)).toBeVisible();
  });

  test('sections collapse and expand, together and one at a time', async ({ page }) => {
    const date = dayAfter(52);
    const code = await registerVisitor(page, { name: 'Collapse Me', tourId: TOUR, date });
    const tour = await getTour(TOUR);

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');

    const mine = section(page, tour.name, date);
    const toggle = mine.getByRole('button', { expanded: true });
    // Open by default.
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(mine.locator('tr', { hasText: code })).toBeVisible();

    await page.getByRole('button', { name: 'Collapse all' }).click();
    await expect(mine.locator('tr', { hasText: code })).toHaveCount(0);

    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(mine.locator('tr', { hasText: code })).toBeVisible();

    // And the section's own header toggles just that one.
    await mine.getByRole('button', { expanded: true }).click();
    await expect(mine.locator('tr', { hasText: code })).toHaveCount(0);
  });

  test('filters work across sections, empty ones disappear, and a no-match state shows', async ({ page }) => {
    const date = dayAfter(53);
    const mineCode = await registerVisitor(page, { name: 'Filter Subject', tourId: TOUR, date });
    await patchTour(TOUR_IDS.diriyah, { date: '' });
    const otherCode = await registerVisitor(page, { name: 'Other Tour', tourId: TOUR_IDS.diriyah, date });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');
    await expect(row(page, mineCode)).toBeVisible({ timeout: 20_000 });
    await expect(row(page, otherCode)).toBeVisible();

    // Searching narrows to one section.
    await page.getByPlaceholder('Search code, name, email, phone or passport').fill(mineCode);
    await expect(row(page, mineCode)).toBeVisible();
    await expect(row(page, otherCode)).toHaveCount(0);
    await expect(page.locator('section')).toHaveCount(1); // empty sections are hidden

    // The tour filter does the same.
    await page.getByPlaceholder('Search code, name, email, phone or passport').fill('');
    await page.getByLabel('Tour').selectOption(TOUR_IDS.diriyah);
    await expect(row(page, otherCode)).toBeVisible();
    await expect(row(page, mineCode)).toHaveCount(0);

    // Nothing matches at all -> a clear empty state, and no sections.
    await page.getByLabel('Tour').selectOption('');
    await page.getByPlaceholder('Search code, name, email, phone or passport').fill('NOSUCHCODE');
    await expect(page.getByText('No registrations match. Clear the search or change the filters.')).toBeVisible();
    await expect(page.locator('section')).toHaveCount(0);
  });

  test('passport, nationality and date are shown, and old rows show an em dash', async ({ page }) => {
    const passport = testPassport();
    const date = dayAfter(54);
    const code = await registerVisitor(page, {
      name: 'Full Record', tourId: TOUR, idNumber: passport, nationality: 'Indian', date,
    });

    // A registration written before these fields existed must not break the page.
    const legacy = 'ZZL999';
    await adminDb().from('registrations').insert({
      code: legacy, name: 'Legacy Visitor', email: `e2e+legacy${Date.now()}@tour.test`,
      phone: '+966501234567', phone_country: 'SA',
      // A row from before the ID fields existed: blank, not absent.
      id_type: 'passport', id_number: '', nationality: '',
      tour_id: TOUR, tour_name: (await getTour(TOUR)).name, slot: 'morning',
      tour_date: date, status: 'pending', updated_by: 'visitor',
    });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');

    const mine = row(page, code);
    await expect(mine).toBeVisible({ timeout: 20_000 });
    await expect(mine).toContainText(passport);
    await expect(mine).toContainText('Indian');
    await expect(mine).toContainText(longDate(date));

    const old = row(page, legacy);
    await expect(old).toBeVisible();
    await expect(old).toContainText('Legacy Visitor');
    // The column also carries a small type tag, so the dash is what matters here.
    await expect(old.locator('td').nth(2)).toContainText('—'); // no ID number on record
    await expect(old.locator('td').nth(3)).toHaveText('—');    // no nationality

    await adminDb().from('registrations').delete().eq('code', legacy);
  });

  test('the Crowd team picks a specific trip, and can search by passport', async ({ page }) => {
    const passport = testPassport();
    const date = dayAfter(55);
    const tour = await getTour(TOUR);
    const here = await registerVisitor(page, {
      name: 'Crowd Trip Subject', tourId: TOUR, nationality: 'Egyptian', idNumber: passport, date,
    });
    const elsewhere = await registerVisitor(page, {
      name: 'Crowd Other Day', tourId: TOUR, date: dayAfter(56),
    });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');
    for (const code of [here, elsewhere]) {
      await row(page, code).getByRole('button', { name: 'Confirm', exact: true }).click();
    }
    // Wait for both writes to land before signing out, or they die with the auth session.
    for (const code of [here, elsewhere]) {
      await expect.poll(async () => (await getReg(code))?.status, { timeout: 20_000 })
        .toBe('confirmed');
    }
    await page.getByRole('button', { name: 'Sign out' }).click();

    await signIn(page, 'crowd');
    await page.goto('/admin/crowd');
    // The picker lists one option per trip, not one per tour.
    await page.getByLabel('Trip').selectOption(`${TOUR}|${date}|${tour.departureTime}`);

    const card = (code: string) => page.locator('li', { hasText: code });
    await expect(card(here)).toBeVisible({ timeout: 20_000 });
    await expect(card(elsewhere)).toHaveCount(0); // different day, different trip

    await expect(card(here)).toContainText(passport);
    await page.getByLabel('Find a visitor').fill(passport);
    await expect(card(here)).toBeVisible();
  });
});

test.describe('Registrations: delete', () => {
  test.beforeEach(async () => { await patchTour(TOUR, { date: '' }); });

  test('the PO can delete: the seat comes back and an audit entry is written', async ({ page }) => {
    const passport = testPassport();
    const date = dayAfter(57);
    const code = await registerVisitor(page, {
      name: 'Delete Me', tourId: TOUR, nationality: 'Egyptian', idNumber: passport, date,
    });
    const before = (await getTour(TOUR)).registeredCount;

    await signIn(page, 'po');
    await page.goto('/admin/registrations');
    const target = row(page, code);
    await expect(target).toBeVisible({ timeout: 20_000 });

    await target.getByRole('button', { name: 'Delete', exact: true }).click();

    // A real modal, naming everything the PO needs to check.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Delete Me');
    await expect(dialog).toContainText(code);
    await expect(dialog).toContainText(passport);
    await expect(dialog).toContainText(
      "This permanently deletes the registration and can't be undone."
    );
    await dialog.getByRole('button', { name: 'Delete registration' }).click();

    await expect(target).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('status')).toContainText('Registration deleted');
    expect(await getReg(code)).toBeUndefined();
    await expect.poll(async () => (await getTour(TOUR)).registeredCount, { timeout: 20_000 })
      .toBe(before - 1);

    const entry = await waitForAudit(code, 'registration:delete');
    expect(entry.byRole).toBe('po');
    expect(entry.detail).toContain('Delete Me');
    expect(entry.detail).toContain(passport);
    expect(entry.detail).toContain(date);
  });

  test('deleting an already-cancelled registration does not double-release the seat', async ({ page }) => {
    const code = await registerVisitor(page, { name: 'Cancelled Then Deleted', tourId: TOUR });
    const taken = (await getTour(TOUR)).registeredCount;

    await signIn(page, 'po');
    await page.goto('/admin/registrations');
    const target = row(page, code);
    await expect(target).toBeVisible({ timeout: 20_000 });

    page.once('dialog', (d) => d.accept());
    await target.getByRole('button', { name: 'Cancel' }).click();
    await expect(target).toContainText('Cancelled');
    // Cancelling gives the seat back...
    await expect.poll(async () => (await getTour(TOUR)).registeredCount, { timeout: 20_000 })
      .toBe(taken - 1);

    await target.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete registration' }).click();
    await expect(target).toHaveCount(0, { timeout: 20_000 });
    await waitForAudit(code, 'registration:delete');

    // ...and deleting it afterwards must not give it back a second time.
    expect((await getTour(TOUR)).registeredCount).toBe(taken - 1);
  });

  test('"Keep it" leaves the registration exactly where it was', async ({ page }) => {
    const code = await registerVisitor(page, { name: 'Keep Me', tourId: TOUR });
    const taken = (await getTour(TOUR)).registeredCount;

    await signIn(page, 'po');
    await page.goto('/admin/registrations');
    const target = row(page, code);
    await expect(target).toBeVisible({ timeout: 20_000 });

    await target.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep it' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(target).toBeVisible();
    expect(await getReg(code)).toBeTruthy();
    expect((await getTour(TOUR)).registeredCount).toBe(taken);
    expect((await auditFor(code)).some((e) => e.action === 'registration:delete')).toBe(false);
  });

  test('the dialog traps focus, closes on Escape, and hands focus back', async ({ page }) => {
    const code = await registerVisitor(page, { name: 'Focus Trap', tourId: TOUR });

    await signIn(page, 'po');
    await page.goto('/admin/registrations');
    const target = row(page, code);
    await expect(target).toBeVisible({ timeout: 20_000 });

    const trigger = target.getByRole('button', { name: 'Delete', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Opens on the safe choice.
    await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused();

    // Tab cycles between the two buttons and never escapes the dialog.
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Delete registration' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Delete registration' })).toBeFocused();

    // Escape closes it, and focus returns to the button that opened it.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await getReg(code)).toBeTruthy();
  });

  for (const role of ['pm', 'registration'] as Role[]) {
    test(`${role} sees no Delete button`, async ({ page }) => {
      const code = await registerVisitor(page, { name: `No Delete For ${role}`, tourId: TOUR });

      await signIn(page, role);
      await page.goto('/admin/registrations');
      const target = row(page, code);
      await expect(target).toBeVisible({ timeout: 20_000 });
      await expect(target.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
      // ...but the actions they DO have are still there.
      await expect(target.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    });
  }

  test('crowd never sees the Registrations page at all', async ({ page }) => {
    await signIn(page, 'crowd');
    await page.goto('/admin/registrations');
    await expect(page.getByRole('heading', { name: /isn’t available to your role/ })).toBeVisible();
  });

  for (const role of ['pm', 'registration', 'crowd'] as Role[]) {
    test(`the database refuses a direct delete by ${role}`, async ({ page }) => {
      const code = await registerVisitor(page, { name: `Rules Delete ${role}`, tourId: TOUR });
      const client = await clientAs(role);

      // No delete policy exists on registrations, so the row simply stays put.
      await client.from('registrations').delete().eq('code', code);
      expect(await getReg(code), 'the registration must survive').toBeTruthy();

      // And the RPC refuses anyone but the PO.
      const { error } = await client.rpc('delete_registration', { p_code: code });
      expect(error, `${role} must not delete`).not.toBeNull();
      expect(await getReg(code)).toBeTruthy();

      // No audit entry was forged either.
      expect((await auditFor(code)).some((e) => e.action === 'registration:delete')).toBe(false);
    });
  }
});

test.describe('Registrations: live participant counts', () => {
  test.beforeEach(async () => { await patchTour(TOUR, { date: '' }); });

  test('the heading total matches the rows, and follows registering and cancelling live', async ({ browser, page }) => {
    const date = dayAfter(58);
    const tour = await getTour(TOUR);
    const first = await registerVisitor(page, { name: 'Count One', tourId: TOUR, date });

    const admin = await browser.newContext();
    const adminPage = await admin.newPage();
    await signIn(adminPage, 'registration');
    await adminPage.goto('/admin/registrations');

    const mine = section(adminPage, tour.name, date);
    const total = mine.getByText(/^\d+ registered · \d+ seats left \(\d+\)$/);
    await expect(total).toBeVisible({ timeout: 20_000 });

    const read = async () => {
      const m = (await total.innerText()).match(/^(\d+) registered · (\d+) seats left \((\d+)\)$/)!;
      return { registered: Number(m[1]), left: Number(m[2]), capacity: Number(m[3]) };
    };

    // The headline agrees with the rows on screen and with capacity arithmetic.
    let c = await read();
    expect(c.registered).toBe(await mine.locator('tbody tr').count());
    expect(c.registered + c.left).toBe(c.capacity);
    const before = c.registered;

    // A new registration in another browser raises it with no reload.
    const second = await registerVisitor(page, { name: 'Count Two', tourId: TOUR, date });
    await expect(total).toHaveText(
      new RegExp(`^${before + 1} registered · ${c.capacity - before - 1} seats left`), { timeout: 20_000 }
    );
    expect(await mine.locator('tbody tr').count()).toBe(before + 1);

    // Cancelling lowers it again, and the cancelled row stays visible but uncounted.
    adminPage.once('dialog', (d) => d.accept());
    await mine.locator('tr', { hasText: second }).getByRole('button', { name: 'Cancel' }).click();
    await expect(total).toHaveText(new RegExp(`^${before} registered · `), { timeout: 20_000 });
    await expect(mine.locator('tr', { hasText: second })).toContainText('Cancelled');
    await expect(mine.getByText(/^Cancelled \d+$/)).toBeVisible();

    // And the trip's count matches the tour's own seat counter.
    c = await read();
    await expect.poll(async () => (await getTour(TOUR)).registeredCount, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(c.registered);
    // No drift warning is shown when they agree.
    await expect(mine.getByText(/Count mismatch/)).toHaveCount(0);
    expect(first).toMatch(/^[A-Z2-9]{6}$/);

    await admin.close();
  });

  test('Overview and the Crowd picker show the same totals', async ({ page }) => {
    const date = dayAfter(59);
    const tour = await getTour(TOUR);
    await registerVisitor(page, { name: 'Shared Count A', tourId: TOUR, date });
    await registerVisitor(page, { name: 'Shared Count B', tourId: TOUR, date });
    const trip = `${TOUR}|${date}|${tour.departureTime}`;

    await signIn(page, 'po');
    await page.goto('/admin/registrations');
    const mine = section(page, tour.name, date);
    await expect(mine.getByText(/^2 registered · /)).toBeVisible({ timeout: 20_000 });

    // Overview: one row per trip, registered / capacity and seats left.
    await page.goto('/admin');
    const overviewRow = page.locator(`tr[data-trip="${trip}"]`);
    await expect(overviewRow).toBeVisible({ timeout: 20_000 });
    await expect(overviewRow.locator('td').nth(1)).toHaveText(`2 / ${tour.capacity}`);
    await expect(overviewRow.locator('td').nth(2)).toHaveText(String(tour.capacity - 2));

    // Crowd's trip picker carries the same number.
    await page.goto('/admin/crowd');
    const option = page.locator(`#tour option[value="${trip}"]`);
    await expect(option).toHaveText(/2 registered$/);
  });

  test('a seat counter that has drifted is reported to the PO but not to the Registration team', async ({ page }) => {
    const date = dayAfter(60);
    const tour = await getTour(TOUR);
    await registerVisitor(page, { name: 'Drift Subject', tourId: TOUR, date });

    // Break the counter behind the app's back, exactly as a lost write would.
    await patchTour(TOUR, { registeredCount: tour.registeredCount + 7 });

    await signIn(page, 'po');
    await page.goto('/admin/registrations');
    const mine = section(page, tour.name, date);
    await expect(mine.getByText(/Count mismatch/)).toBeVisible({ timeout: 20_000 });
    await page.goto('/admin');
    await expect(page.getByText(/Count mismatch/).first()).toBeVisible({ timeout: 20_000 });

    // The Registration team can't fix tours, so they aren't shown the warning.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, 'registration');
    await page.goto('/admin/registrations');
    await expect(section(page, tour.name, date)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Count mismatch/)).toHaveCount(0);

    await patchTour(TOUR, { registeredCount: tour.registeredCount });
  });
});
