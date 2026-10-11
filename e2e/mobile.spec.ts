/** The Crowd page is used one-handed at the pickup area. Runs at 390x844. */
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  LOGO_ALTS, TOUR_IDS, dayAfter, expectLogos, getReg, getTour, noSidewaysScroll,
  patchTour, registerVisitor, signIn, testEmail,
} from './helpers';

const TOUR = TOUR_IDS.kapsarc;
const DATE = dayAfter(1);
let TRIP = '';

test.beforeAll(async () => {
  await patchTour(TOUR, { date: '' });
  TRIP = `${TOUR}|${DATE}|${(await getTour(TOUR)).departureTime}`;
});

/** The two narrowest phones we support. */
const PHONES = [{ width: 360, height: 800 }, { width: 375, height: 812 }] as const;

async function asRole(browser: Browser, role: 'registration' | 'crowd', url: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await signIn(page, role);
  await page.goto(url);
  return { ctx, page };
}

const card = (page: Page, code: string) => page.locator('li', { hasText: code });

test.describe('Crowd page on a phone (390x844)', () => {
  test('search box autofocuses, buttons clear 44px, and nothing scrolls sideways', async ({ page }) => {
    // The picker lists only trips that exist, so this spec has to create its own
    // rather than relying on another spec having run first.
    await registerVisitor(page, { name: 'Phone Picker', tourId: TOUR, date: DATE });
    await signIn(page, 'crowd');
    await page.goto('/admin/crowd');
    await page.getByLabel('Trip').selectOption(TRIP);

    const search = page.getByLabel('Find a visitor');
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();

    // Every visible control is at least 44px tall.
    const controls = page.locator('button:visible, a.btn:visible, input:visible, select:visible');
    const n = await controls.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const box = await controls.nth(i).boundingBox();
      if (!box) continue;
      const label = (await controls.nth(i).getAttribute('aria-label'))
        ?? (await controls.nth(i).innerText().catch(() => '')) ?? `control ${i}`;
      expect(box.height, `"${label.trim().slice(0, 40)}" is ${box.height}px tall`).toBeGreaterThanOrEqual(44);
    }

    await noSidewaysScroll(page);
  });

  test('the full pickup flow works at phone size', async ({ browser, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const code = await registerVisitor(page, { name: 'Phone Flow', email: testEmail(), tourId: TOUR, date: DATE });

    const reg = await asRole(browser, 'registration', '/admin/registrations');
    await reg.page.locator('tr', { hasText: code }).getByRole('button', { name: 'Confirm', exact: true }).click();

    const crowd = await asRole(browser, 'crowd', '/admin/crowd');
    await crowd.page.getByLabel('Trip').selectOption(TRIP);
    const c = card(crowd.page, code);
    await expect(c).toBeVisible({ timeout: 20_000 });

    await c.getByRole('button', { name: 'Check in' }).click();
    await expect(c).toContainText('At pickup');

    await crowd.page.getByLabel('Bus number').fill('7');
    await c.getByRole('button', { name: 'Board bus 7' }).click();
    await expect(c).toContainText('On the bus');
    await expect(c).toContainText('Bus 7');
    // The card updates from Firestore's local echo before the server acknowledges the
    // write, so the stored value has to be polled rather than read once.
    await expect.poll(async () => (await getReg(code))?.busNumber, { timeout: 20_000 }).toBe('7');

    // Still no sideways scroll with a populated list.
    await noSidewaysScroll(crowd.page);

    await reg.ctx.close();
    await crowd.ctx.close();
  });

  test('searching by code narrows the list', async ({ browser, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const a = await registerVisitor(page, { name: 'Search Alpha', email: testEmail(), tourId: TOUR, date: DATE });
    const b = await registerVisitor(page, { name: 'Search Beta', email: testEmail(), tourId: TOUR, date: DATE });

    const reg = await asRole(browser, 'registration', '/admin/registrations');
    for (const code of [a, b]) {
      await reg.page.locator('tr', { hasText: code }).getByRole('button', { name: 'Confirm', exact: true }).click();
    }

    const crowd = await asRole(browser, 'crowd', '/admin/crowd');
    await crowd.page.getByLabel('Trip').selectOption(TRIP);
    await expect(card(crowd.page, a)).toBeVisible({ timeout: 20_000 });
    await expect(card(crowd.page, b)).toBeVisible();

    await crowd.page.getByLabel('Find a visitor').fill(a);
    await expect(card(crowd.page, a)).toBeVisible();
    await expect(card(crowd.page, b)).toHaveCount(0);

    await reg.ctx.close();
    await crowd.ctx.close();
  });
});

test.describe('Logos on a narrow phone', () => {
  for (const phone of PHONES) {
    for (const [label, path] of [['public form', '/'], ['login', '/login']] as const) {
      test(`${phone.width}px ${label}: three logos on one row, no sideways scroll`, async ({ page }) => {
        await page.setViewportSize(phone);
        await page.goto(path);

        const boxes = await expectLogos(page);
        // One row: every logo shares the same vertical band.
        const tops = boxes.map((b) => b.h);
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
        // 32–36px on a phone, and all three inside the viewport.
        expect(boxes[0].h).toBeGreaterThanOrEqual(28);
        expect(boxes[0].h).toBeLessThanOrEqual(38);
        expect(boxes[0].x, 'first logo starts off-screen').toBeGreaterThanOrEqual(0);
        expect(boxes[2].right, 'third logo overflows the phone').toBeLessThanOrEqual(phone.width);

        await noSidewaysScroll(page);
      });
    }
  }

  test('confirmation page keeps them; the admin header hides them below md', async ({ page }) => {
    await page.setViewportSize(PHONES[0]);
    await registerVisitor(page, { name: 'Logo Phone', tourId: TOUR, date: DATE });
    await expectLogos(page);
    await noSidewaysScroll(page);

    await signIn(page, 'crowd');
    await page.goto('/admin');
    // 360px is below the md breakpoint, so the header logos are hidden.
    for (const alt of LOGO_ALTS) {
      await expect(page.locator('header').getByAltText(alt, { exact: true })).toBeHidden();
    }
    await expect(page.locator('header').getByText('Tour operations')).toBeVisible();
    await noSidewaysScroll(page);
  });
});
