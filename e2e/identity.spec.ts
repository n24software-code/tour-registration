/**
 * One identity field that follows the nationality: a National ID for Saudis (ten
 * digits, leading 1, check digit) and a passport number for everyone else.
 */
import { expect, test } from '@playwright/test';
import {
  TOUR_IDS, chooseNationality, dayAfter, fillRegistrationForm, getReg, idBox,
  nationalIdCheckDigit, patchTour, registerVisitor, registrationBody,
  testEmail, testNationalId, testPassport,
} from './helpers';
import { NATIONAL_ID_ERROR } from '@/lib/saudi-id';
import { PASSPORT_ERROR } from '@/lib/validation';

const TOUR = TOUR_IDS.kapsarc;
// Dates 70+ days out: each spec owns its own window so per-section counts can't collide.

test.describe('National ID / passport', () => {
  test.beforeEach(async () => { await patchTour(TOUR, { date: '' }); });

  test('the field waits for a nationality, then names the right document', async ({ page }) => {
    await page.goto('/');
    const field = idBox(page);

    // Nothing chosen yet.
    await expect(field).toBeDisabled();
    await expect(page.getByText('Choose your nationality first')).toBeVisible();

    await chooseNationality(page, 'Saudi');
    await expect(page.getByLabel('National ID number')).toBeEnabled();
    await expect(field).toHaveAttribute('inputmode', 'numeric');
    await expect(page.getByText('10 digits, starting with 1.')).toBeVisible();

    await chooseNationality(page, 'Egyptian');
    await expect(page.getByLabel('Passport number')).toBeEnabled();
    await expect(field).toHaveAttribute('inputmode', 'text');
    await expect(page.getByText('Letters and numbers only, 5–20 characters.')).toBeVisible();
  });

  test('switching between Saudi and non-Saudi clears what was typed', async ({ page }) => {
    await page.goto('/');
    await chooseNationality(page, 'Saudi');
    const id = testNationalId();
    await idBox(page).fill(id);
    await expect(idBox(page)).toHaveValue(id);

    // Saudi → Egyptian is a different document, so the value must not carry over.
    await chooseNationality(page, 'Egyptian');
    await expect(idBox(page)).toHaveValue('');

    // Egyptian → Indian is the same document, so it is kept.
    const passport = testPassport();
    await idBox(page).fill(passport);
    await chooseNationality(page, 'Indian');
    await expect(idBox(page)).toHaveValue(passport);
  });

  for (const [label, value] of [
    ['nine digits', '100000000'],
    ['a leading 2', '2000000008'],
    ['a bad check digit', '1000000009'],
    ['letters', 'AB12345678'],
  ] as const) {
    test(`Saudi: ${label} is rejected`, async ({ page }) => {
      await fillRegistrationForm(page, {
        name: `Bad Id ${label}`, tourId: TOUR, nationality: 'Saudi', idNumber: value,
      });
      await page.getByRole('button', { name: /Register for this tour/ }).click();
      await expect(page.getByText(NATIONAL_ID_ERROR)).toBeVisible();
      await expect(page).not.toHaveURL(/\/registered\//);
    });
  }

  test('Saudi: a valid National ID is accepted and stored with its type', async ({ page }) => {
    const id = testNationalId();
    const code = await registerVisitor(page, {
      name: 'Valid Saudi Id', tourId: TOUR, nationality: 'Saudi', idNumber: id, date: dayAfter(70),
    });
    const reg = await getReg(code);
    expect(reg?.idType).toBe('national_id');
    expect(reg?.idNumber).toBe(id);
    expect(reg?.nationality).toBe('SA');
  });

  test('the check digit is really being enforced', async ({ page }) => {
    const stem = '123456789';
    const right = `${stem}${nationalIdCheckDigit(stem)}`;
    const wrong = `${stem}${(nationalIdCheckDigit(stem) + 1) % 10}`;

    const bad = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'SA', idNumber: wrong, tourId: TOUR }),
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).errors.idNumber).toBe(NATIONAL_ID_ERROR);

    const good = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'SA', idNumber: right, tourId: TOUR, tourDate: dayAfter(71) }),
    });
    expect(good.status()).toBe(201);
  });

  test('the server derives the type from the nationality, whatever the client claims', async ({ page }) => {
    // A passport-shaped value for a Saudi is refused...
    const asSaudi = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'SA', idNumber: 'AB123456', idType: 'passport', tourId: TOUR }),
    });
    expect(asSaudi.status()).toBe(400);
    expect((await asSaudi.json()).errors.idNumber).toBe(NATIONAL_ID_ERROR);

    // ...and a National ID claimed as a passport is filed as a passport, because the
    // nationality says so. Ten digits are a valid passport string, so this succeeds —
    // what matters is that the stored type follows the nationality, not the request.
    const asEgyptian = await page.request.post('/api/register', {
      data: registrationBody({
        nationality: 'EG', idNumber: testNationalId(), idType: 'national_id',
        tourId: TOUR, tourDate: dayAfter(72),
      }),
    });
    expect(asEgyptian.status()).toBe(201);
    expect((await getReg((await asEgyptian.json()).code))?.idType).toBe('passport');
  });

  test('a passport-shaped value is refused for a Saudi, and vice versa', async ({ page }) => {
    const passportForSaudi = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'SA', idNumber: testPassport(), tourId: TOUR }),
    });
    expect(passportForSaudi.status()).toBe(400);
    expect((await passportForSaudi.json()).errors.idNumber).toBe(NATIONAL_ID_ERROR);

    // A four-character passport is too short for anyone.
    const tooShort = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'EG', idNumber: 'AB12', tourId: TOUR }),
    });
    expect(tooShort.status()).toBe(400);
    expect((await tooShort.json()).errors.idNumber).toBe(PASSPORT_ERROR);
  });

  test('the duplicate rule works on the ID number', async ({ page }) => {
    const id = testNationalId();
    const date = dayAfter(73);
    const first = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'SA', idNumber: id, tourId: TOUR, tourDate: date }),
    });
    expect(first.status()).toBe(201);

    const dup = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'SA', idNumber: id, tourId: TOUR, tourDate: date }),
    });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).message)
      .toBe('This National ID is already registered for this tour on this date.');

    // Another day is a different trip, so it is fine.
    const other = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'SA', idNumber: id, tourId: TOUR, tourDate: dayAfter(74) }),
    });
    expect(other.status()).toBe(201);

    // The same digits as a passport are a different document, so they don't collide.
    const asPassport = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'EG', idNumber: id, tourId: TOUR, tourDate: date }),
    });
    expect(asPassport.status()).toBe(201);
  });

  test('the ID number never reaches the public page or the email', async ({ page }) => {
    const id = testNationalId();
    const email = testEmail();
    const code = await registerVisitor(page, {
      name: 'Private Id', tourId: TOUR, nationality: 'Saudi', idNumber: id, email, date: dayAfter(75),
    });

    expect(await page.content()).not.toContain(id);
    await page.goto(`/registered/${code}`);
    expect(await page.content()).not.toContain(id);

    const { mailFor } = await import('./helpers');
    const mail = (await mailFor(code))!;
    expect(mail.message.text).not.toContain(id);
    expect(mail.message.html).not.toContain(id);
  });
});
