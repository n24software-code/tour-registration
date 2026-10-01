import { expect, test } from '@playwright/test';
import {
  TOUR_IDS, getReg, getTour, patchTour, registerVisitor, testEmail, adminDb,
} from './helpers';

test.describe('Public registration', () => {
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

  test('client validation flags a short name, a bad email, a bad phone and a missing tour', async ({ page }) => {
    await page.goto('/');

    // Nothing filled in at all -> the tour error shows.
    await page.getByRole('button', { name: /Register for this tour/ }).click();
    await expect(page.getByText('Choose a tour above.')).toBeVisible();

    const radio = page.locator(`input[name="tour"][value="${TOUR_IDS.kapsarc}"]`);
    await page.locator('label', { has: radio }).click();
    await page.getByLabel('Full name').fill('A');                 // too short
    await page.getByLabel('Email').fill('not-an-email');          // bad
    await page.getByLabel('Phone number').fill('123');            // too few digits
    await page.getByRole('button', { name: /Register for this tour/ }).click();

    await expect(page.getByText('Enter your full name (at least 2 characters).')).toBeVisible();
    await expect(page.getByText('Enter a valid email address, like name@example.com.')).toBeVisible();
    await expect(page.getByText(/Enter a phone number with 8.15 digits/)).toBeVisible();
    await expect(page.getByText('Choose a tour above.')).toHaveCount(0);

    // Nothing was written.
    expect(await adminDb().collection('registrations').where('email', '==', 'not-an-email').get())
      .toHaveProperty('empty', true);
  });

  for (const [label, phone] of [
    ['Saudi local', '050 123 4567'],
    ['Saudi international', '+966 50 123 4567'],
    ['international', '+44 20 7946 0958'],
  ] as const) {
    test(`accepts a ${label} phone number`, async ({ page }) => {
      const email = testEmail();
      const code = await registerVisitor(page, {
        name: `Phone ${label}`, email, phone, tourId: TOUR_IDS.sabic,
      });
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      const reg = await getReg(code);
      // Stored normalised: leading + kept, separators stripped.
      expect(reg?.email).toBe(email);
      expect(await (async () => (await adminDb().collection('registrations').doc(code).get()).data()!.phone)())
        .toBe(phone.replace(/(?!^\+)[^\d]/g, ''));
    });
  }

  test('a valid registration lands on /registered/[CODE] with first name, code, pickup, time and the arrival note', async ({ page }) => {
    const email = testEmail();
    const code = await registerVisitor(page, {
      name: 'Layla Al Qahtani', email, tourId: TOUR_IDS.kapsarc,
    });
    const tour = await getTour(TOUR_IDS.kapsarc);

    expect(code).toHaveLength(6);
    await expect(page).toHaveURL(new RegExp(`/registered/${code}$`));

    // First name only - the surname must not leak on a public URL.
    await expect(page.getByText("You’re registered, Layla.")).toBeVisible();
    await expect(page.getByText('Al Qahtani')).toHaveCount(0);

    await expect(page.locator('p', { hasText: new RegExp(`^${code}$`) })).toBeVisible();
    await expect(page.getByText(tour.pickupPoint)).toBeVisible();
    await expect(page.getByText(tour.departureTime, { exact: false })).toBeVisible();
    await expect(page.getByText('Arrive 15 minutes before departure.')).toBeVisible();
  });

  test('the same email cannot register twice for one tour, but can after cancelling', async ({ page }) => {
    const email = testEmail();
    const first = await registerVisitor(page, { name: 'Repeat Visitor', email, tourId: TOUR_IDS.aramco });

    // Second attempt is rejected.
    const dup = await page.request.post('/api/register', {
      data: { name: 'Repeat Visitor', email, phone: '0501234567', tourId: TOUR_IDS.aramco },
    });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).message).toContain('already registered for this tour');

    // After cancelling, the same email may register again.
    await adminDb().collection('registrations').doc(first).update({ status: 'cancelled' });
    const again = await page.request.post('/api/register', {
      data: { name: 'Repeat Visitor', email, phone: '0501234567', tourId: TOUR_IDS.aramco },
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
      data: { name: 'Full Tour', email: testEmail(), phone: '0501234567', tourId: TOUR_IDS.downtown },
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
      data: { name: 'Closed Tour', email: testEmail(), phone: '0501234567', tourId: TOUR_IDS.diriyah },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toBe('Registration for this tour is closed. Choose another tour.');

    await patchTour(TOUR_IDS.diriyah, { active: true });
  });
});
