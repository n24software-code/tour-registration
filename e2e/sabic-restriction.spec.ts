/**
 * SABIC cannot host Iraqi, Yemeni, Lebanese or Syrian visitors. The rule lives on the
 * tour document (`restrictedNationalities`), so these tests check the data, the browser
 * and — most importantly — the server, which is the only thing a visitor can't bypass.
 */
import { expect, test } from '@playwright/test';
import {
  TOUR_IDS, chooseNationality, dayAfter, getReg, getTour, patchTour,
  registerVisitor, registrationBody, signIn, testPassport,
} from './helpers';

const BLOCKED = [
  { code: 'IQ', label: 'Iraqi' },
  { code: 'YE', label: 'Yemeni' },
  { code: 'LB', label: 'Lebanese' },
  { code: 'SY', label: 'Syrian' },
] as const;

const MESSAGE =
  "Visitors with Iraqi, Yemeni, Lebanese or Syrian nationality can't join the SABIC tour. "
  + 'Please choose another tour.';

const sabicCard = (page: import('@playwright/test').Page) =>
  page.locator('label', { has: page.locator(`input[name="tour"][value="${TOUR_IDS.sabic}"]`) });

test.describe('SABIC nationality restriction', () => {
  test('the rule is stored on the tour, and only on SABIC', async () => {
    expect((await getTour(TOUR_IDS.sabic)).restrictedNationalities)
      .toEqual(['IQ', 'YE', 'LB', 'SY']);

    for (const id of [TOUR_IDS.kapsarc, TOUR_IDS.aramco, TOUR_IDS.diriyah, TOUR_IDS.downtown]) {
      expect((await getTour(id)).restrictedNationalities ?? [], `${id} must be unrestricted`)
        .toEqual([]);
    }
  });

  for (const { label } of BLOCKED) {
    test(`client: choosing ${label} disables the SABIC card with the reason`, async ({ page }) => {
      await page.goto('/');
      await chooseNationality(page, label);

      const card = sabicCard(page);
      await expect(card.locator('input[name="tour"]')).toBeDisabled();
      await expect(card).toContainText(MESSAGE);

      // Other tours stay available.
      await expect(page.locator(`input[name="tour"][value="${TOUR_IDS.kapsarc}"]`)).toBeEnabled();
    });
  }

  test('client: an already-chosen SABIC is cleared, with the message shown', async ({ page }) => {
    await page.goto('/');
    await chooseNationality(page, 'Saudi');

    const radio = page.locator(`input[name="tour"][value="${TOUR_IDS.sabic}"]`);
    await sabicCard(page).click();
    await expect(radio).toBeChecked();

    // Now switch to a blocked nationality: the selection has to go.
    await chooseNationality(page, 'Syrian');
    await expect(radio).not.toBeChecked();
    await expect(radio).toBeDisabled();
    await expect(page.locator('.field-error', { hasText: MESSAGE })).toBeVisible();
  });

  for (const { code, label } of BLOCKED) {
    test(`server: POST /api/register with nationality ${code} (${label}) is refused`, async ({ page }) => {
      const res = await page.request.post('/api/register', {
        data: registrationBody({ tourId: TOUR_IDS.sabic, nationality: code }),
      });
      expect(res.status()).toBe(409);
      const body = await res.json();
      expect(body.message).toBe(MESSAGE);
      expect(body.errors.nationality).toBe(MESSAGE);
    });
  }

  test('server: SA is accepted for SABIC', async ({ page }) => {
    const passport = testPassport();
    const res = await page.request.post('/api/register', {
      data: registrationBody({ tourId: TOUR_IDS.sabic, nationality: 'SA', passportNumber: passport }),
    });
    expect(res.status()).toBe(201);
    const code = (await res.json()).code as string;
    expect((await getReg(code))?.nationality).toBe('SA');
  });

  test('server: a non-SABIC tour accepts IQ', async ({ page }) => {
    await patchTour(TOUR_IDS.kapsarc, { date: '' });
    const res = await page.request.post('/api/register', {
      data: registrationBody({ tourId: TOUR_IDS.kapsarc, nationality: 'IQ', tourDate: dayAfter(1) }),
    });
    expect(res.status()).toBe(201);
    expect((await getReg((await res.json()).code))?.nationality).toBe('IQ');
  });

  test('a blocked visitor can still register for another tour through the form', async ({ page }) => {
    await patchTour(TOUR_IDS.kapsarc, { date: '' });
    const code = await registerVisitor(page, {
      name: 'Blocked Elsewhere', tourId: TOUR_IDS.kapsarc, nationality: 'Lebanese',
    });
    expect((await getReg(code))?.nationality).toBe('LB');
  });

  test('PO/PM can read and edit the restriction on the Tours page', async ({ page }) => {
    await signIn(page, 'pm');
    await page.goto('/admin/tours');

    const sabic = await getTour(TOUR_IDS.sabic);
    const picker = page.getByLabel(`Restricted nationalities for ${sabic.name}`);
    // toHaveValues reports DOM (alphabetical) order, not the order the tour stores.
    await expect(picker).toHaveValues(['IQ', 'LB', 'SY', 'YE']);

    const row = page.locator('tr', { has: picker });
    await expect(row).toContainText('Blocked: Iraqi, Yemeni, Lebanese, Syrian');

    // Add Egyptian, save, and the tour document follows.
    await picker.selectOption(['IQ', 'YE', 'LB', 'SY', 'EG']);
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('button', { name: 'Saved' })).toBeVisible();
    await expect
      .poll(async () => (await getTour(TOUR_IDS.sabic)).restrictedNationalities, { timeout: 15_000 })
      .toContain('EG');

    // The server now refuses Egyptians too...
    const res = await page.request.post('/api/register', {
      data: registrationBody({ tourId: TOUR_IDS.sabic, nationality: 'EG' }),
    });
    expect(res.status()).toBe(409);

    // ...and putting it back restores the original four.
    await picker.selectOption(['IQ', 'YE', 'LB', 'SY']);
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('button', { name: 'Saved' })).toBeVisible();
    await expect
      .poll(async () => (await getTour(TOUR_IDS.sabic)).restrictedNationalities, { timeout: 15_000 })
      .toEqual(['IQ', 'YE', 'LB', 'SY']);
  });
});
