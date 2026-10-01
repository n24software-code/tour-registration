/** The Crowd page is used one-handed at the pickup area. Runs at 390x844. */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { TOUR_IDS, getReg, registerVisitor, signIn, testEmail } from './helpers';

const TOUR = TOUR_IDS.kapsarc;

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
    await signIn(page, 'crowd');
    await page.goto('/admin/crowd');
    await page.getByLabel('Tour').selectOption(TOUR);

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

    // No horizontal scroll.
    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(scrollW).toBeLessThanOrEqual(clientW);
  });

  test('the full pickup flow works at phone size', async ({ browser, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const code = await registerVisitor(page, { name: 'Phone Flow', email: testEmail(), tourId: TOUR });

    const reg = await asRole(browser, 'registration', '/admin/registrations');
    await reg.page.locator('tr', { hasText: code }).getByRole('button', { name: 'Confirm' }).click();

    const crowd = await asRole(browser, 'crowd', '/admin/crowd');
    await crowd.page.getByLabel('Tour').selectOption(TOUR);
    const c = card(crowd.page, code);
    await expect(c).toBeVisible({ timeout: 20_000 });

    await c.getByRole('button', { name: 'Check in' }).click();
    await expect(c).toContainText('At pickup');

    await crowd.page.getByLabel('Bus number').fill('7');
    await c.getByRole('button', { name: 'Board bus 7' }).click();
    await expect(c).toContainText('On the bus');
    await expect(c).toContainText('Bus 7');
    expect((await getReg(code))?.busNumber).toBe('7');

    // Still no sideways scroll with a populated list.
    const { scrollW, clientW } = await crowd.page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(scrollW).toBeLessThanOrEqual(clientW);

    await reg.ctx.close();
    await crowd.ctx.close();
  });

  test('searching by code narrows the list', async ({ browser, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const a = await registerVisitor(page, { name: 'Search Alpha', email: testEmail(), tourId: TOUR });
    const b = await registerVisitor(page, { name: 'Search Beta', email: testEmail(), tourId: TOUR });

    const reg = await asRole(browser, 'registration', '/admin/registrations');
    for (const code of [a, b]) {
      await reg.page.locator('tr', { hasText: code }).getByRole('button', { name: 'Confirm' }).click();
    }

    const crowd = await asRole(browser, 'crowd', '/admin/crowd');
    await crowd.page.getByLabel('Tour').selectOption(TOUR);
    await expect(card(crowd.page, a)).toBeVisible({ timeout: 20_000 });
    await expect(card(crowd.page, b)).toBeVisible();

    await crowd.page.getByLabel('Find a visitor').fill(a);
    await expect(card(crowd.page, a)).toBeVisible();
    await expect(card(crowd.page, b)).toHaveCount(0);

    await reg.ctx.close();
    await crowd.ctx.close();
  });
});
