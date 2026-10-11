/**
 * Country code + national number, validated with libphonenumber-js on both sides and
 * stored in E.164.
 */
import { expect, test } from '@playwright/test';
import {
  TOUR_IDS, chooseCountryCode, chooseNationality, countryBox, dayAfter,
  fillRegistrationForm, getReg, patchTour, registerVisitor, registrationBody, signIn,
} from './helpers';
import { PHONE_ERROR } from '@/lib/phone';

const TOUR = TOUR_IDS.kapsarc;
// Dates 80+ days out: each spec owns its own window.

test.describe('Mobile number', () => {
  test.beforeEach(async () => { await patchTour(TOUR, { date: '' }); });

  test('defaults to Saudi Arabia +966', async ({ page }) => {
    await page.goto('/');
    await expect(countryBox(page)).toHaveValue(/Saudi Arabia \+966/);
    // The chosen code is echoed beside the number field.
    await expect(page.getByText('+966', { exact: true })).toBeVisible();
  });

  test('follows the nationality until the visitor picks a code themselves', async ({ page }) => {
    await page.goto('/');

    await chooseNationality(page, 'British');
    await expect(countryBox(page)).toHaveValue(/United Kingdom \+44/);

    await chooseNationality(page, 'Indian');
    await expect(countryBox(page)).toHaveValue(/India \+91/);

    // Once overridden, the nationality stops moving it.
    await chooseCountryCode(page, 'EG');
    await expect(countryBox(page)).toHaveValue(/Egypt \+20/);
    await chooseNationality(page, 'French');
    await expect(countryBox(page)).toHaveValue(/Egypt \+20/);
  });

  test('the selector is searchable by name and by dial code', async ({ page }) => {
    await page.goto('/');
    const box = countryBox(page);
    await box.click();

    await box.fill('united king');
    await expect(page.locator('[role="option"][data-value="GB"]')).toBeVisible();

    await box.fill('+971');
    await expect(page.locator('[role="option"][data-value="AE"]')).toBeVisible();
  });

  test('a Saudi number is stored in E.164 with its country', async ({ page }) => {
    const code = await registerVisitor(page, {
      name: 'Saudi Phone', tourId: TOUR, phone: '0501234567', date: dayAfter(80),
    });
    const reg = await getReg(code);
    expect(reg?.phone).toBe('+966501234567');
    expect(reg?.phoneCountry).toBe('SA');
  });

  test('a number valid elsewhere is rejected for the selected country', async ({ page }) => {
    // A UK landline typed while Saudi Arabia is selected.
    await fillRegistrationForm(page, {
      name: 'Wrong Country', tourId: TOUR, phone: '2079460958', phoneCountry: 'SA',
    });
    await page.getByRole('button', { name: /Register for this tour/ }).click();
    await expect(page.getByText(PHONE_ERROR)).toBeVisible();
    await expect(page).not.toHaveURL(/\/registered\//);

    // The same digits with the right country are fine.
    await chooseCountryCode(page, 'GB');
    await page.getByRole('button', { name: /Register for this tour/ }).click();
    await expect(page).toHaveURL(/\/registered\/[A-Z2-9]{6}/, { timeout: 30_000 });
    const code = page.url().split('/').pop()!.toUpperCase();
    expect((await getReg(code))?.phone).toBe('+442079460958');
    expect((await getReg(code))?.phoneCountry).toBe('GB');
  });

  for (const [label, country, number] of [
    ['too short for Saudi Arabia', 'SA', '12345'],
    ['not a number at all', 'SA', 'abcdefgh'],
    ['too long for Egypt', 'EG', '123456789012345'],
  ] as const) {
    test(`server rejects ${label}`, async ({ page }) => {
      const res = await page.request.post('/api/register', {
        data: registrationBody({ phoneCountry: country, phone: number, tourId: TOUR }),
      });
      expect(res.status()).toBe(400);
      expect((await res.json()).errors.phone).toBe(PHONE_ERROR);
    });
  }

  test('admin lists show the number formatted, and tel: still works', async ({ page }) => {
    const code = await registerVisitor(page, {
      name: 'Formatted Phone', tourId: TOUR, phone: '0501234567', date: dayAfter(81),
    });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');
    const row = page.locator('tr', { hasText: code });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('+966 50 123 4567');
    await expect(row.locator('a[href="tel:+966501234567"]')).toHaveCount(1);
  });

  test('Crowd finds a visitor with or without the country code', async ({ page }) => {
    const date = dayAfter(82);
    const tour = await (await import('./helpers')).getTour(TOUR);
    const code = await registerVisitor(page, {
      name: 'Crowd Phone', tourId: TOUR, phone: '0512345678', date,
    });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');
    await page.locator('tr', { hasText: code }).getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(async () => (await getReg(code))?.status, { timeout: 20_000 }).toBe('confirmed');
    await page.getByRole('button', { name: 'Sign out' }).click();

    await signIn(page, 'crowd');
    await page.goto('/admin/crowd');
    await page.getByLabel('Trip').selectOption(`${TOUR}|${date}|${tour.departureTime}`);
    const card = page.locator('li', { hasText: code });
    await expect(card).toBeVisible({ timeout: 20_000 });

    const search = page.getByLabel('Find a visitor');
    for (const query of ['512345678', '0512345678', '+966512345678', '966512345678']) {
      await search.fill(query);
      await expect(card, `searching "${query}"`).toBeVisible();
    }
    await search.fill('999888777');
    await expect(card).toHaveCount(0);
  });
});
