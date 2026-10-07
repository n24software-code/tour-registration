import { expect, test } from '@playwright/test';
import {
  TOUR_IDS, adminDb, dayAfter, expectLogos, fillRegistrationForm, getReg, getTour,
  nationalityBox, patchTour, registerVisitor, registrationBody, testEmail, testPassport,
} from './helpers';

/** Mirrors formatDate() in components/ui.tsx. */
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
});

const PASSPORT_ERROR = 'Enter your passport number as shown in your passport (letters and numbers only).';

test.describe('Public registration', () => {
  test('the partner logos sit at the top of the public form', async ({ page }) => {
    await page.goto('/');
    await expectLogos(page);
    // Real dimensions are rendered, so the browser reserves the box before the bytes land.
    for (const img of await page.locator('header img, div[dir="ltr"] img').all()) {
      expect(Number(await img.getAttribute('width'))).toBeGreaterThan(0);
      expect(Number(await img.getAttribute('height'))).toBeGreaterThan(0);
    }
  });

  test('tour list shows Morning and Evening groups with pickup point, time and seats left', async ({ page }) => {
    await page.goto('/');

    const morning = page.getByRole('radiogroup', { name: 'Morning tours' });
    const evening = page.getByRole('radiogroup', { name: 'Evening tours' });
    await expect(morning).toBeVisible();
    await expect(evening).toBeVisible();

    const tour = await getTour(TOUR_IDS.kapsarc);
    const card = page.locator('label', { has: page.locator(`input[value="${TOUR_IDS.kapsarc}"]`) });
    await expect(card).toContainText(tour.name);
    await expect(card).toContainText(tour.departureTime);          // time
    await expect(card).toContainText(tour.pickupPoint);            // pickup point
    await expect(card).toContainText(/\d+ seats? left|Full|Registration closed/); // seats left

    // The morning group holds the morning tours and the evening group the evening ones.
    await expect(morning.locator(`input[value="${TOUR_IDS.kapsarc}"]`)).toHaveCount(1);
    await expect(evening.locator(`input[value="${TOUR_IDS.diriyah}"]`)).toHaveCount(1);
  });

  test('every required field is flagged when the form is submitted empty', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Register for this tour/ }).click();

    await expect(page.getByText('Enter your full name (at least 2 characters).')).toBeVisible();
    await expect(page.getByText(/Enter a phone number with 8.15 digits/)).toBeVisible();
    await expect(page.getByText(PASSPORT_ERROR)).toBeVisible();
    await expect(page.getByText('Choose your nationality.')).toBeVisible();
    await expect(page.getByText('Choose a tour above.')).toBeVisible();
    await expect(page.getByText('Choose the date of your tour.')).toBeVisible();

    // Email is the one optional field, so it must NOT complain when left empty.
    await expect(page.getByText('Enter a valid email address, like name@example.com.')).toHaveCount(0);
  });

  test('a malformed passport is rejected on the client and on the server', async ({ page }) => {
    await fillRegistrationForm(page, {
      name: 'Bad Passport', tourId: TOUR_IDS.kapsarc, passport: 'AB-12!',
    });
    await page.getByRole('button', { name: /Register for this tour/ }).click();
    await expect(page.getByText(PASSPORT_ERROR)).toBeVisible();
    await expect(page).not.toHaveURL(/\/registered\//);

    for (const passport of ['AB-12!', 'AB12', 'A'.repeat(21)]) {
      const res = await page.request.post('/api/register', {
        data: registrationBody({ passportNumber: passport, tourId: TOUR_IDS.kapsarc }),
      });
      expect(res.status(), `passport "${passport}"`).toBe(400);
      expect((await res.json()).errors.passportNumber).toBe(PASSPORT_ERROR);
    }
  });

  test('a date in the past is refused by the client and the server', async ({ page }) => {
    await patchTour(TOUR_IDS.aramco, { date: '' });
    await fillRegistrationForm(page, {
      name: 'Time Traveller', tourId: TOUR_IDS.aramco, date: dayAfter(-1),
    });
    await page.getByRole('button', { name: /Register for this tour/ }).click();
    await expect(page.getByText('That date has passed. Choose today or a later date.')).toBeVisible();
    await expect(page).not.toHaveURL(/\/registered\//);

    const res = await page.request.post('/api/register', {
      data: registrationBody({ tourId: TOUR_IDS.aramco, tourDate: dayAfter(-1) }),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).errors.tourDate).toBe('That date has passed. Choose today or a later date.');
  });

  test('a tour with a fixed date fills the date in, read-only, and rejects any other date', async ({ page }) => {
    const fixed = dayAfter(10);
    await patchTour(TOUR_IDS.downtown, { date: fixed });

    await page.goto('/');
    const radio = page.locator(`input[name="tour"][value="${TOUR_IDS.downtown}"]`);
    await page.locator('label', { has: radio }).click();

    const date = page.getByLabel('Date', { exact: true });
    await expect(date).toHaveValue(fixed);
    expect(await date.evaluate((el: HTMLInputElement) => el.readOnly)).toBe(true);

    // The server refuses a different day even if the form is bypassed.
    const res = await page.request.post('/api/register', {
      data: registrationBody({ tourId: TOUR_IDS.downtown, tourDate: dayAfter(11) }),
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).errors.tourDate).toBe(`This tour runs on ${fixed}. Choose that date.`);

    await patchTour(TOUR_IDS.downtown, { date: '' });
  });

  test('nationality must come from the list, and is stored as an ISO code', async ({ page }) => {
    const passport = testPassport();
    const code = await registerVisitor(page, {
      name: 'Nationality Visitor', tourId: TOUR_IDS.kapsarc, passport, nationality: 'Egyptian',
    });
    expect((await getReg(code))?.nationality).toBe('EG');

    // A code that isn't in lib/nationalities.ts is refused by the server.
    const res = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'XX' }),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).errors.nationality).toBe('Choose a nationality from the list.');
  });

  for (const [label, phone] of [
    ['Saudi local', '050 123 4567'],
    ['Saudi international', '+966 50 123 4567'],
    ['international', '+44 20 7946 0958'],
  ] as const) {
    test(`accepts a ${label} mobile number`, async ({ page }) => {
      const email = testEmail();
      const code = await registerVisitor(page, {
        name: `Phone ${label}`, email, phone, tourId: TOUR_IDS.sabic, nationality: 'Saudi',
      });
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      const reg = await getReg(code);
      // Stored normalised: leading + kept, separators stripped.
      expect(reg?.email).toBe(email);
      expect(reg?.phone).toBe(phone.replace(/(?!^\+)[^\d]/g, ''));
    });
  }

  test('email is optional: no address, no problem, and no mail document', async ({ page }) => {
    const mailBefore = (await adminDb().collection('mail').count().get()).data().count;
    const code = await registerVisitor(page, { name: 'No Email Visitor', tourId: TOUR_IDS.kapsarc });

    const reg = await getReg(code);
    expect(reg?.email ?? null).toBeNull();
    expect(reg?.status).toBe('pending');
    expect((await adminDb().collection('mail').count().get()).data().count).toBe(mailBefore);
  });

  test('an email that IS filled in still has to look like an email', async ({ page }) => {
    await fillRegistrationForm(page, {
      name: 'Bad Email', tourId: TOUR_IDS.kapsarc, email: 'not-an-email',
    });
    await page.getByRole('button', { name: /Register for this tour/ }).click();
    await expect(page.getByText('Enter a valid email address, like name@example.com.')).toBeVisible();

    expect(await adminDb().collection('registrations').where('email', '==', 'not-an-email').get())
      .toHaveProperty('empty', true);
  });

  test('a valid registration lands on /registered/[CODE] with the date, and never the passport', async ({ page }) => {
    const passport = testPassport();
    const date = dayAfter(3);
    await patchTour(TOUR_IDS.kapsarc, { date: '' });
    const code = await registerVisitor(page, {
      name: 'Layla Al Qahtani', email: testEmail(), tourId: TOUR_IDS.kapsarc, passport, date,
    });
    const tour = await getTour(TOUR_IDS.kapsarc);

    expect(code).toHaveLength(6);
    await expect(page).toHaveURL(new RegExp(`/registered/${code}$`));
    await expectLogos(page);

    // First name only - the surname must not leak on a public URL.
    await expect(page.getByText("You’re registered, Layla.")).toBeVisible();
    await expect(page.getByText('Al Qahtani')).toHaveCount(0);

    await expect(page.locator('p', { hasText: new RegExp(`^${code}$`) })).toBeVisible();
    await expect(page.getByText(tour.pickupPoint)).toBeVisible();
    await expect(page.getByText(tour.departureTime, { exact: false })).toBeVisible();
    await expect(page.getByText('Arrive 15 minutes before departure.')).toBeVisible();

    // The date is shown...
    await expect(page.getByText(longDate(date))).toBeVisible();
    // ...and the passport number is not, anywhere on the page.
    expect(await page.content()).not.toContain(passport);

    expect((await getReg(code))?.tourDate).toBe(date);
    expect((await getReg(code))?.departureTime).toBe(tour.departureTime);
  });

  test('one passport per tour per date: same day rejected, another day fine, cancelling frees it', async ({ page }) => {
    await patchTour(TOUR_IDS.aramco, { date: '' });
    const passport = testPassport();
    const date = dayAfter(2);

    const first = await registerVisitor(page, {
      name: 'Repeat Visitor', tourId: TOUR_IDS.aramco, passport, date,
    });

    // Same passport, same tour, same date -> rejected.
    const dup = await page.request.post('/api/register', {
      data: registrationBody({ passportNumber: passport, tourId: TOUR_IDS.aramco, tourDate: date }),
    });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).message).toBe('This passport is already registered for this tour on this date.');

    // Same passport, same tour, a DIFFERENT date -> accepted.
    const otherDay = await page.request.post('/api/register', {
      data: registrationBody({ passportNumber: passport, tourId: TOUR_IDS.aramco, tourDate: dayAfter(3) }),
    });
    expect(otherDay.status()).toBe(201);

    // After cancelling the first one, that same day is free again.
    await adminDb().collection('registrations').doc(first).update({ status: 'cancelled' });
    const again = await page.request.post('/api/register', {
      data: registrationBody({ passportNumber: passport, tourId: TOUR_IDS.aramco, tourDate: date }),
    });
    expect(again.status()).toBe(201);
    const secondCode = (await again.json()).code as string;
    expect(secondCode).not.toBe(first);
    expect((await getReg(secondCode))?.status).toBe('pending');
  });

  test('a full tour is disabled and the API answers "This tour is full."', async ({ page }) => {
    const before = await getTour(TOUR_IDS.downtown);
    // capacity = registeredCount -> zero seats left.
    await patchTour(TOUR_IDS.downtown, { capacity: Math.max(1, before.registeredCount), registeredCount: Math.max(1, before.registeredCount) });

    await page.goto('/');
    const input = page.locator(`input[name="tour"][value="${TOUR_IDS.downtown}"]`);
    await expect(input).toBeDisabled();
    const card = page.locator('label', { has: input });
    await expect(card).toContainText('Full');

    const res = await page.request.post('/api/register', {
      data: registrationBody({ tourId: TOUR_IDS.downtown }),
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toBe('This tour is full. Choose another tour.');

    await patchTour(TOUR_IDS.downtown, { capacity: before.capacity, registeredCount: before.registeredCount });
  });

  test('a closed tour is disabled and the API answers "Registration for this tour is closed."', async ({ page }) => {
    await patchTour(TOUR_IDS.diriyah, { active: false });

    await page.goto('/');
    const input = page.locator(`input[name="tour"][value="${TOUR_IDS.diriyah}"]`);
    await expect(input).toBeDisabled();
    await expect(page.locator('label', { has: input })).toContainText('Registration closed');

    const res = await page.request.post('/api/register', {
      data: registrationBody({ tourId: TOUR_IDS.diriyah }),
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toBe('Registration for this tour is closed. Choose another tour.');

    await patchTour(TOUR_IDS.diriyah, { active: true });
  });

  test('the nationality list is searchable and Saudi is pinned to the top', async ({ page }) => {
    await page.goto('/');
    const input = nationalityBox(page);
    await input.click();
    await expect(page.getByRole('option').first()).toHaveText('Saudi');

    await input.fill('egyp');
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('option')).toHaveText('Egyptian');

    await input.fill('zzzz');
    await expect(page.getByText('No nationality matches that.')).toBeVisible();
  });
});
