/**
 * The three partner logos: Ministry of Energy, 25th WPC Energy Congress, WPC Energy —
 * in that order, same height, on a white band at the top of every public page, and
 * smaller in the admin header (desktop only).
 */
import { expect, test } from '@playwright/test';
import {
  LOGO_ALTS, TOUR_IDS, dayAfter, expectLogos, noSidewaysScroll, patchTour,
  registerVisitor, signIn,
} from './helpers';

const PUBLIC_PAGES = [
  ['the registration form', '/'],
  ['the sign-in page', '/login'],
  ['a page that does not exist', '/registered/ZZZZZZ'],
] as const;

test.describe('Partner logos', () => {
  for (const [label, path] of PUBLIC_PAGES) {
    test(`all three appear in order on ${label}`, async ({ page }) => {
      await page.goto(path);
      const boxes = await expectLogos(page);
      // 56px from the sm breakpoint up (the desktop project runs at 1280px).
      expect(boxes[0].h).toBeGreaterThanOrEqual(48);
      expect(boxes[0].h).toBeLessThanOrEqual(60);
      await noSidewaysScroll(page);
    });
  }

  test('the confirmation page carries them too', async ({ page }) => {
    await patchTour(TOUR_IDS.kapsarc, { date: '' });
    await registerVisitor(page, {
      name: 'Logo Confirmation', tourId: TOUR_IDS.kapsarc, date: dayAfter(1),
    });
    await expect(page).toHaveURL(/\/registered\/[A-Z2-9]{6}/);
    await expectLogos(page);
    await noSidewaysScroll(page);
  });

  test('they sit on a white band with a bottom border, above the heading', async ({ page }) => {
    await page.goto('/');
    const band = page.getByAltText(LOGO_ALTS[0]).locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
    const style = await band.evaluate((el) => {
      const c = getComputedStyle(el);
      return { bg: c.backgroundColor, borderBottom: c.borderBottomWidth };
    });
    expect(style.bg).toBe('rgb(255, 255, 255)');
    expect(parseFloat(style.borderBottom)).toBeGreaterThan(0);

    // The band is above the page heading.
    const bandBox = (await band.boundingBox())!;
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    expect(bandBox.y).toBeLessThan(heading.y);
  });

  test('the order survives dir="rtl"', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    // expectLogos asserts left-to-right positions, so this fails if the row mirrors.
    await expectLogos(page);
  });

  test('admin header: shown at 1280px, at about 28px', async ({ page }) => {
    await signIn(page, 'crowd');
    await page.goto('/admin');
    const header = page.locator('header');
    const boxes = await expectLogos(page, header);
    expect(boxes[0].h).toBeGreaterThanOrEqual(24);
    expect(boxes[0].h).toBeLessThanOrEqual(32);
    await noSidewaysScroll(page);
  });

  test('admin header: shown at exactly 768px, hidden at 767px', async ({ page }) => {
    await signIn(page, 'crowd');
    await page.goto('/admin');
    const header = page.locator('header');

    await page.setViewportSize({ width: 768, height: 900 });
    await expect(header.getByAltText(LOGO_ALTS[0], { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 767, height: 900 });
    for (const alt of LOGO_ALTS) {
      await expect(header.getByAltText(alt, { exact: true })).toBeHidden();
    }
    // "Tour operations" stays, so the header never looks broken.
    await expect(header.getByText('Tour operations')).toBeVisible();
  });

  test('every logo is served and never distorted', async ({ page }) => {
    await page.goto('/');
    for (const alt of LOGO_ALTS) {
      const img = page.getByAltText(alt, { exact: true });
      const m = await img.evaluate((el: HTMLImageElement) => ({
        natural: el.naturalWidth / el.naturalHeight,
        rendered: el.clientWidth / el.clientHeight,
        complete: el.complete,
        naturalWidth: el.naturalWidth,
      }));
      expect(m.complete, `${alt} did not load`).toBe(true);
      expect(m.naturalWidth, `${alt} is empty`).toBeGreaterThan(0);
      // Aspect ratio preserved: no crop, no squash.
      expect(Math.abs(m.natural - m.rendered), `${alt} is distorted`).toBeLessThan(0.05);
    }
  });
});
