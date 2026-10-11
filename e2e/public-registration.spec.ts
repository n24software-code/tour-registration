import { expect, test } from '@playwright/test';
import {
  TOUR_IDS, adminDb, dayAfter, expectLogos, fillRegistrationForm, getReg, getTour, mailsTo,
  nationalityBox, patchTour, registerVisitor, registrationBody, signIn, testEmail,
  testPassport, waitForAudit,
} from './helpers';
import { EMAIL_ERROR } from '@/lib/validation';
import { PHONE_ERROR } from '@/lib/phone';

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
    await expect(page.getByText(PHONE_ERROR)).toBeVisible();
    await expect(page.getByText('Choose your nationality.')).toBeVisible();
    await expect(page.getByText('Choose a tour above.')).toBeVisible();
    await expect(page.getByText('Choose the date of your tour.')).toBeVisible();

    // Email is required now, and the ID field waits for a nationality.
    await expect(page.getByText(EMAIL_ERROR)).toBeVisible();
    await expect(page.getByText('Choose your nationality first.')).toBeVisible();
  });

  test('a malformed passport is rejected on the client and on the server', async ({ page }) => {
    await fillRegistrationForm(page, {
      name: 'Bad Passport', tourId: TOUR_IDS.kapsarc, nationality: 'Egyptian', idNumber: 'AB-12!',
    });
    await page.getByRole('button', { name: /Register for this tour/ }).click();
    await expect(page.getByText(PASSPORT_ERROR)).toBeVisible();
    await expect(page).not.toHaveURL(/\/registered\//);

    for (const passport of ['AB-12!', 'AB12', 'A'.repeat(21)]) {
      const res = await page.request.post('/api/register', {
        data: registrationBody({ nationality: 'EG', idNumber: passport, tourId: TOUR_IDS.kapsarc }),
      });
      expect(res.status(), `passport "${passport}"`).toBe(400);
      expect((await res.json()).errors.idNumber).toBe(PASSPORT_ERROR);
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
      name: 'Nationality Visitor', tourId: TOUR_IDS.kapsarc, idNumber: passport, nationality: 'Egyptian',
    });
    expect((await getReg(code))?.nationality).toBe('EG');

    // A code that isn't in lib/nationalities.ts is refused by the server.
    const res = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'XX' }),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).errors.nationality).toBe('Choose a nationality from the list.');
  });

  for (const [label, country, phone, stored] of [
    ['Saudi local', 'SA', '050 123 4567', '+966501234567'],
    ['Saudi with the code typed in', 'SA', '+966 50 123 4567', '+966501234567'],
    ['British', 'GB', '020 7946 0958', '+442079460958'],
  ] as const) {
    test(`accepts a ${label} mobile number`, async ({ page }) => {
      const email = testEmail();
      const code = await registerVisitor(page, {
        name: `Phone ${label}`, email, phone, phoneCountry: country,
        tourId: TOUR_IDS.sabic, nationality: 'Saudi',
      });
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      const reg = await getReg(code);
      // However it was typed, it is stored in E.164 alongside its country.
      expect(reg?.email).toBe(email);
      expect(reg?.phone).toBe(stored);
      expect(reg?.phoneCountry).toBe(country);
    });
  }

  test('email is required on the client and the server, and is stored lowercase', async ({ page }) => {
    // Client: leaving it empty blocks the submit.
    await fillRegistrationForm(page, { name: 'No Email Visitor', tourId: TOUR_IDS.kapsarc, email: ' ' });
    await page.getByLabel('Email', { exact: true }).fill('');
    await page.getByRole('button', { name: /Register for this tour/ }).click();
    await expect(page.getByText(EMAIL_ERROR)).toBeVisible();
    await expect(page).not.toHaveURL(/\/registered\//);

    // Server: the same, for anything that bypasses the form.
    const res = await page.request.post('/api/register', { data: registrationBody({ email: '' }) });
    expect(res.status()).toBe(400);
    expect((await res.json()).errors.email).toBe(EMAIL_ERROR);

    // A mixed-case address is stored lowercase.
    const mixed = testEmail().toUpperCase();
    const ok = await page.request.post('/api/register', { data: registrationBody({ email: mixed }) });
    expect(ok.status()).toBe(201);
    expect((await getReg((await ok.json()).code))?.email).toBe(mixed.toLowerCase());
  });

  test('every successful registration queues exactly one booking confirmation', async ({ page }) => {
    const email = testEmail();
    const tour = await getTour(TOUR_IDS.kapsarc);
    await patchTour(TOUR_IDS.kapsarc, { date: '' });
    const date = dayAfter(2);
    const code = await registerVisitor(page, {
      name: 'Mail Visitor', tourId: TOUR_IDS.kapsarc, email, date,
    });

    const mails = await mailsTo(email);
    expect(mails, 'exactly one mail document per registration').toHaveLength(1);
    const mail = mails[0];
    expect((await getReg(code))?.mailId).toBe(mail.id);
    expect(mail.to).toBe(email);
    expect(mail.message.subject).toBe(`Booking confirmed – ${tour.name} – ${code}`);

    // The HTML escapes every value that came from data — this tour's name has an "&".
    const escaped = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    expect(tour.name).toContain('&');
    expect(mail.message.html).not.toContain(tour.name);
    expect(mail.message.html).toContain(escaped(tour.name));

    expect(mail.message.text).toContain(tour.name);
    for (const body of [mail.message.text, mail.message.html]) {
      expect(body).toContain(code);
      expect(body).toContain(tour.pickupPoint);
      expect(body).toContain(tour.departureTime);
      expect(body).toContain(longDate(date));   // the readable date, not the ISO string
      expect(body).toContain('Arrive 15 minutes before departure');
    }
    expect(mail.message.html).toContain(`/registered/${code}`);

    // A script tag in a visitor's name must never survive into the markup.
    const nasty = await page.request.post('/api/register', {
      data: registrationBody({
        name: '<script>alert(1)</script> Nasty', tourId: TOUR_IDS.kapsarc, tourDate: dayAfter(3),
      }),
    });
    expect(nasty.status()).toBe(201);
    const nastyMail = (await mailsTo((await getReg((await nasty.json()).code))!.email!))[0];
    expect(nastyMail.message.html).not.toContain('<script>');
    expect(nastyMail.message.html).toContain('&lt;script&gt;');
  });

  test('Resend confirmation queues a second mail doc and writes an audit entry', async ({ page }) => {
    const email = testEmail();
    await patchTour(TOUR_IDS.kapsarc, { date: '' });
    const code = await registerVisitor(page, {
      name: 'Resend Visitor', tourId: TOUR_IDS.kapsarc, email, date: dayAfter(4),
    });
    const first = (await getReg(code))!.mailId;
    expect((await mailsTo(email))).toHaveLength(1);

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');
    const row = page.locator('tr', { hasText: code });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: 'Resend confirmation' }).click();

    await expect(page.getByRole('status')).toContainText(`Confirmation re-sent to ${email}`);
    await expect.poll(async () => (await mailsTo(email)).length, { timeout: 20_000 }).toBe(2);

    // The registration now points at the new document, so the badge follows the resend.
    const second = (await getReg(code))!.mailId;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    const entry = await waitForAudit(code, 'registration:resend');
    expect(entry.byRole).toBe('registration');
    expect(entry.detail).toContain(email);

    // Both copies are addressed and titled the same way.
    for (const m of await mailsTo(email)) {
      expect(m.to).toBe(email);
      expect(m.message.subject).toContain(code);
    }
  });

  test('the Crowd team cannot resend', async ({ page }) => {
    await signIn(page, 'crowd');
    await page.goto('/admin/registrations');
    await expect(page.getByRole('button', { name: 'Resend confirmation' })).toHaveCount(0);
  });

  test('a malformed email is rejected', async ({ page }) => {
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
      name: 'Layla Al Qahtani', email: testEmail(), tourId: TOUR_IDS.kapsarc,
      nationality: 'Egyptian', idNumber: passport, date,
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

  test('one ID per tour per date: same day rejected, another day fine, cancelling frees it', async ({ page }) => {
    await patchTour(TOUR_IDS.aramco, { date: '' });
    const passport = testPassport();
    const date = dayAfter(2);

    const first = await registerVisitor(page, {
      name: 'Repeat Visitor', tourId: TOUR_IDS.aramco, nationality: 'Egyptian', idNumber: passport, date,
    });

    // Same passport, same tour, same date -> rejected.
    const dup = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'EG', idNumber: passport, tourId: TOUR_IDS.aramco, tourDate: date }),
    });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).message).toBe('This passport is already registered for this tour on this date.');
    expect((await dup.json()).errors?.idNumber ?? '').toContain('already registered');

    // Same passport, same tour, a DIFFERENT date -> accepted.
    const otherDay = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'EG', idNumber: passport, tourId: TOUR_IDS.aramco, tourDate: dayAfter(3) }),
    });
    expect(otherDay.status()).toBe(201);

    // After cancelling the first one, that same day is free again.
    await adminDb().collection('registrations').doc(first).update({ status: 'cancelled' });
    const again = await page.request.post('/api/register', {
      data: registrationBody({ nationality: 'EG', idNumber: passport, tourId: TOUR_IDS.aramco, tourDate: date }),
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
    await expect(page.getByText('Nothing matches that.')).toBeVisible();
  });
});
