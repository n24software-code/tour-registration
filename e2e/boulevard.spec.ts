/**
 * Boulevard City carries trip information and conditions. Everything here is driven by
 * the tour document, so the tests also prove no other tour picks it up.
 */
import { expect, test } from '@playwright/test';
import {
  BOULEVARD_DURATION, BOULEVARD_NOTICES, TOUR_IDS, boulevardTourId, dayAfter,
  fillRegistrationForm, getReg, getTour, mailFor, patchTour, registerVisitor,
  registrationBody, signIn, testEmail,
} from './helpers';
import { CONDITIONS_ERROR } from '@/lib/validation';

const CONSENT = 'I have read these conditions and confirm they don\u2019t apply to me.';
const panel = (page: import('@playwright/test').Page) => page.locator('#trip-info');

test.describe('Boulevard City trip information', () => {
  test('the tour document carries the duration and notices, and no other tour does', async () => {
    const id = await boulevardTourId();
    const tour = await getTour(id);
    expect(tour.experienceDuration).toBe(BOULEVARD_DURATION);
    expect(tour.notices).toEqual(BOULEVARD_NOTICES);

    for (const other of Object.values(TOUR_IDS)) {
      const t = await getTour(other);
      expect(t.notices ?? [], `${other} must have no notices`).toEqual([]);
      expect(t.experienceDuration ?? '', `${other} must have no duration`).toBe('');
    }
  });

  test('the panel appears only while Boulevard City is selected', async ({ page }) => {
    const boulevard = await boulevardTourId();
    await page.goto('/');

    // Nothing selected yet.
    await expect(panel(page)).toHaveCount(0);

    // Another tour: still nothing.
    const other = page.locator(`input[name="tour"][value="${TOUR_IDS.kapsarc}"]`);
    await page.locator('label', { has: other }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByText(BOULEVARD_DURATION)).toHaveCount(0);

    // Boulevard City: duration first, then every notice.
    const radio = page.locator(`input[name="tour"][value="${boulevard}"]`);
    await page.locator('label', { has: radio }).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText('Before you book');
    await expect(panel(page)).toContainText(BOULEVARD_DURATION);
    for (const notice of BOULEVARD_NOTICES) await expect(panel(page)).toContainText(notice);

    // The duration is above the notice list.
    const durationY = (await panel(page).getByText(BOULEVARD_DURATION).boundingBox())!.y;
    const firstNoticeY = (await panel(page).getByText(BOULEVARD_NOTICES[0]).boundingBox())!.y;
    expect(durationY).toBeLessThan(firstNoticeY);

    // The region is announced politely.
    await expect(page.locator('[aria-live="polite"]', { has: panel(page) })).toHaveCount(1);

    // Switching away removes it again.
    await page.locator('label', { has: other }).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('the consent checkbox is required on the client', async ({ page }) => {
    const boulevard = await boulevardTourId();
    await fillRegistrationForm(page, {
      name: 'No Consent', tourId: boulevard, date: dayAfter(90), acceptConditions: false,
    });
    await expect(page.getByLabel(CONSENT)).not.toBeChecked();

    await page.getByRole('button', { name: /Register for this tour/ }).click();
    await expect(page.getByText(CONDITIONS_ERROR)).toBeVisible();
    await expect(page).not.toHaveURL(/\/registered\//);

    // Ticking it lets the booking through.
    await page.getByLabel(CONSENT).check();
    await page.getByRole('button', { name: /Register for this tour/ }).click();
    await expect(page).toHaveURL(/\/registered\/[A-Z2-9]{6}/, { timeout: 30_000 });
    const code = page.url().split('/').pop()!.toUpperCase();
    expect((await getReg(code))?.conditionsAcceptedAt).toBeTruthy();
  });

  test('the server refuses a booking that skipped the checkbox', async ({ page }) => {
    const boulevard = await boulevardTourId();
    const res = await page.request.post('/api/register', {
      data: registrationBody({ tourId: boulevard, tourDate: dayAfter(91), acceptedConditions: false }),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).errors.acceptedConditions).toBe(CONDITIONS_ERROR);

    // ...and accepts it when the box was ticked.
    const ok = await page.request.post('/api/register', {
      data: registrationBody({ tourId: boulevard, tourDate: dayAfter(91), acceptedConditions: true }),
    });
    expect(ok.status()).toBe(201);
  });

  test('a tour without notices never asks for consent', async ({ page }) => {
    await patchTour(TOUR_IDS.kapsarc, { date: '' });
    await page.goto('/');
    const radio = page.locator(`input[name="tour"][value="${TOUR_IDS.kapsarc}"]`);
    await page.locator('label', { has: radio }).click();
    await expect(page.getByLabel(CONSENT)).toHaveCount(0);

    // And the server does not invent the requirement either.
    const res = await page.request.post('/api/register', {
      data: registrationBody({ tourId: TOUR_IDS.kapsarc, tourDate: dayAfter(92), acceptedConditions: false }),
    });
    expect(res.status()).toBe(201);
    expect((await getReg((await res.json()).code))?.conditionsAcceptedAt ?? null).toBeNull();
  });

  test('the confirmation page and the email carry the same information', async ({ page }) => {
    const boulevard = await boulevardTourId();
    const email = testEmail();
    const code = await registerVisitor(page, {
      name: 'Boulevard Visitor', tourId: boulevard, email, date: dayAfter(93),
    });

    // Confirmation page.
    await expect(page.getByText('Before you go')).toBeVisible();
    await expect(page.getByText(BOULEVARD_DURATION)).toBeVisible();
    for (const notice of BOULEVARD_NOTICES) await expect(page.getByText(notice)).toBeVisible();

    // Email.
    const mail = (await mailFor(code))!;
    expect(mail).toBeTruthy();
    for (const body of [mail.message.text, mail.message.html]) {
      expect(body).toContain(BOULEVARD_DURATION);
      for (const notice of BOULEVARD_NOTICES) expect(body).toContain(notice);
    }
  });

  test('the admin lists show the information read-only for that trip', async ({ page }) => {
    const boulevard = await boulevardTourId();
    const tour = await getTour(boulevard);
    const date = dayAfter(94);
    const code = await registerVisitor(page, { name: 'Boulevard Admin', tourId: boulevard, date });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');
    const section = page.locator('section').filter({ hasText: tour.name });
    await expect(section.first()).toBeVisible({ timeout: 20_000 });
    await expect(section.filter({ hasText: BOULEVARD_DURATION }).first()).toBeVisible();

    // Crowd sees it too, once the visitor is confirmed.
    await page.locator('tr', { hasText: code }).getByRole('button', { name: 'Confirm' }).click();
    await expect.poll(async () => (await getReg(code))?.status, { timeout: 20_000 }).toBe('confirmed');
    await page.getByRole('button', { name: 'Sign out' }).click();

    await signIn(page, 'crowd');
    await page.goto('/admin/crowd');
    await page.getByLabel('Trip').selectOption(`${boulevard}|${date}|${tour.departureTime}`);
    await expect(page.getByText(BOULEVARD_DURATION)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(BOULEVARD_NOTICES[0])).toBeVisible();
  });

  test('PO/PM can edit the duration and notices on the Tours page', async ({ page }) => {
    const boulevard = await boulevardTourId();
    const tour = await getTour(boulevard);

    await signIn(page, 'pm');
    await page.goto('/admin/tours');
    const duration = page.getByLabel(`Experience duration for ${tour.name}`);
    await expect(duration).toHaveValue(BOULEVARD_DURATION);

    const row = page.locator('tr', { has: duration });
    await expect(row.getByLabel(`Notice 1 for ${tour.name}`, { exact: true }))
      .toHaveValue(BOULEVARD_NOTICES[0]);

    // Add one, save, and the tour document follows.
    await row.getByRole('button', { name: 'Add notice' }).click();
    await row.getByLabel(`Notice ${BOULEVARD_NOTICES.length + 1} for ${tour.name}`, { exact: true })
      .fill('E2E extra notice');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('button', { name: 'Saved' })).toBeVisible();
    await expect.poll(async () => (await getTour(boulevard)).notices, { timeout: 15_000 })
      .toContain('E2E extra notice');

    // Remove it again and the original four come back.
    await row.getByRole('button', { name: `Remove notice ${BOULEVARD_NOTICES.length + 1} for ${tour.name}` }).click();
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('button', { name: 'Saved' })).toBeVisible();
    await expect.poll(async () => (await getTour(boulevard)).notices, { timeout: 15_000 })
      .toEqual(BOULEVARD_NOTICES);
  });
});
