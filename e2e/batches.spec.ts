/**
 * SABIC and Saudi Aramco each run two departures, held as one tour document per batch.
 * The visitor sees the destination once with a required departure choice; capacity,
 * counts, lists and exports all work per batch.
 */
import { expect, test, type Page } from '@playwright/test';
import { Workbook } from 'exceljs';
import {
  BATCHES, TOUR_IDS, chooseNationality, dayAfter, fillRegistrationForm, fillSeats,
  getReg, getTour, patchTour, registerVisitor, registrationBody, signIn, testEmail,
} from './helpers';

// Dates 100+ days out: each spec owns its own window so per-section counts can't collide.
const DAY = (n: number) => dayAfter(100 + n);

const card = (page: Page, destinationId: string) =>
  page.locator(`[data-destination="${destinationId}"]`);

test.describe('Batches', () => {
  test('the schedule is on the tour documents, and both SABIC batches share the restriction', async () => {
    for (const [dest, batches] of Object.entries(BATCHES)) {
      for (const b of batches) {
        const t = await getTour(b.id);
        expect(t.batch, `${b.id} batch`).toBe(b.batch);
        expect(t.departureTime, `${b.id} time`).toBe(b.departureTime);
        expect(t.capacity, `${b.id} capacity`).toBe(b.capacity);
        expect(t.destinationId, `${b.id} destination`).toBe(dest === 'sabic' ? 'sabic' : 'aramco-kafd');
      }
    }
    // The nationality restriction is a property of the destination, not of batch 1.
    for (const b of BATCHES.sabic) {
      expect((await getTour(b.id)).restrictedNationalities).toEqual(['IQ', 'YE', 'LB', 'SY']);
    }
    for (const b of BATCHES.aramco) {
      expect((await getTour(b.id)).restrictedNationalities ?? []).toEqual([]);
    }
  });

  test('the destination appears once, with both departures and their seats', async ({ page }) => {
    await page.goto('/');
    const sabic = card(page, 'sabic');
    await expect(sabic).toBeVisible();

    // The name is shown once, not once per batch.
    await expect(page.getByText('SABIC - Home of Innovation', { exact: true })).toHaveCount(1);
    await expect(sabic.getByText('Choose a departure')).toBeVisible();

    for (const b of BATCHES.sabic) {
      const left = b.capacity - (await getTour(b.id)).registeredCount;
      await expect(sabic.getByText(
        `Batch ${b.batch} · ${b.departureTime} · ${left} ${left === 1 ? 'seat' : 'seats'} left`
      )).toBeVisible();
    }

    const aramco = card(page, 'aramco-kafd');
    await expect(aramco.getByText(/Batch 1 · 09:00/)).toBeVisible();
    await expect(aramco.getByText(/Batch 2 · 10:00/)).toBeVisible();
  });

  test('a full batch is disabled while the other stays bookable', async ({ page }) => {
    const [b1, b2] = BATCHES.aramco;
    const before = await fillSeats(b1.id);          // 10 of 10 taken
    try {
      await page.goto('/');
      const aramco = card(page, 'aramco-kafd');
      await expect(aramco.getByText(/Batch 1 · 09:00 · Full/)).toBeVisible();
      await expect(aramco.locator(`input[value="${b1.id}"]`)).toBeDisabled();
      await expect(aramco.locator(`input[value="${b2.id}"]`)).toBeEnabled();

      // And the server says so too.
      const res = await page.request.post('/api/register', {
        data: registrationBody({ tourId: b1.id, tourDate: DAY(1) }),
      });
      expect(res.status()).toBe(409);
      expect((await res.json()).message).toBe('This tour is full. Choose another tour.');
    } finally {
      await patchTour(b1.id, { registeredCount: before });
    }
  });

  test('when every batch is full the destination says so', async ({ page }) => {
    const [b1, b2] = BATCHES.aramco;
    const was1 = await fillSeats(b1.id);
    const was2 = await fillSeats(b2.id);
    try {
      await page.goto('/');
      const aramco = card(page, 'aramco-kafd');
      await expect(aramco.getByText('Full – choose another tour')).toBeVisible();
      await expect(aramco.getByText('Choose a departure')).toHaveCount(0);
    } finally {
      await patchTour(b1.id, { registeredCount: was1 });
      await patchTour(b2.id, { registeredCount: was2 });
    }
  });

  test('the SABIC restriction blocks the whole destination, both batches', async ({ page }) => {
    await page.goto('/');
    await chooseNationality(page, 'Syrian');

    const sabic = card(page, 'sabic');
    await expect(sabic).toContainText("can't join the SABIC tour");
    for (const b of BATCHES.sabic) {
      await expect(sabic.locator(`input[value="${b.id}"]`)).toHaveCount(0);
    }
    // Aramco is untouched.
    await expect(card(page, 'aramco-kafd').locator(`input[value="${TOUR_IDS.aramco}"]`)).toBeEnabled();

    // The server refuses batch 2 just as firmly as batch 1.
    for (const b of BATCHES.sabic) {
      const res = await page.request.post('/api/register', {
        data: registrationBody({ tourId: b.id, nationality: 'SY', tourDate: DAY(2) }),
      });
      expect(res.status(), `batch ${b.batch}`).toBe(409);
    }
  });

  test('booking a batch records that batch, and it reaches the page and the email', async ({ page }) => {
    const [, b2] = BATCHES.sabic;
    const email = testEmail();
    const code = await registerVisitor(page, {
      name: 'Batch Two Visitor', tourId: b2.id, email, date: DAY(3),
    });

    const reg = await getReg(code);
    expect(reg?.batch).toBe(2);
    expect(reg?.departureTime).toBe('09:00');

    // Confirmation page.
    await expect(page.getByText('Batch 2 · departs 09:00')).toBeVisible();

    // Email.
    const { mailFor } = await import('./helpers');
    const mail = (await mailFor(code))!;
    expect(mail.message.subject).toContain('Batch 2');
    for (const body of [mail.message.text, mail.message.html]) {
      expect(body).toContain('09:00');
      expect(body).toMatch(/Batch.{0,20}2/s);
    }
  });

  test('only one of three simultaneous bookings gets the last seat', async ({ page }) => {
    const [b1] = BATCHES.aramco;
    const t = await getTour(b1.id);
    const before = t.registeredCount;
    // One seat left.
    await fillSeats(b1.id, t.capacity - 1);
    const date = DAY(4);

    try {
      const results = await Promise.all([1, 2, 3].map((i) =>
        page.request.post('/api/register', {
          data: registrationBody({
            name: `Race ${i}`, tourId: b1.id, tourDate: date, email: testEmail(),
          }),
        })
      ));
      const statuses = results.map((r) => r.status());
      expect(statuses.filter((s) => s === 201), `got ${statuses.join(',')}`).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(2);

      // The counter landed exactly on capacity — no overbooking, no lost seat.
      await expect.poll(async () => (await getTour(b1.id)).registeredCount, { timeout: 20_000 })
        .toBe(t.capacity);
    } finally {
      await patchTour(b1.id, { registeredCount: before });
    }
  });

  test('the admin sections, Crowd picker and Excel all name the batch', async ({ page }) => {
    const [, b2] = BATCHES.sabic;
    const date = DAY(5);
    const tour = await getTour(b2.id);
    const code = await registerVisitor(page, { name: 'Batch Admin', tourId: b2.id, date });

    await signIn(page, 'registration');
    await page.goto('/admin/registrations');

    const section = page.locator('section').filter({ hasText: 'SABIC - Home of Innovation – Batch 2' });
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section).toContainText('09:00');
    await expect(section.locator('tr', { hasText: code })).toHaveCount(1);

    // Excel: a Batch column, filled in.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      section.getByRole('button', { name: /Save \/ Export/ }).click(),
    ]);
    expect(download.suggestedFilename()).toContain('batch2');
    const wb = new Workbook();
    await wb.xlsx.readFile((await download.path())!);
    const ws = wb.worksheets[0];
    expect(String(ws.getCell('A1').value)).toContain('Batch 2');
    const header = (ws.getRow(2).values as unknown[]).slice(1).map(String);
    expect(header).toContain('Batch');
    const row = (ws.getRow(3).values as unknown[]).slice(1);
    expect(row[header.indexOf('Batch')]).toBe(2);

    // Overview names it too.
    await page.goto('/admin');
    await expect(page.locator(`tr[data-trip="${b2.id}|${date}|${tour.departureTime}"]`))
      .toContainText('Batch 2');

    // And the Crowd trip picker.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, 'crowd');
    await page.goto('/admin/crowd');
    await expect(page.locator(`#tour option[value="${b2.id}|${date}|${tour.departureTime}"]`))
      .toHaveText(/Batch 2/);
  });

  test('a non-batched destination still books in one click', async ({ page }) => {
    await patchTour(TOUR_IDS.kapsarc, { date: '' });
    await fillRegistrationForm(page, { name: 'No Batch', tourId: TOUR_IDS.kapsarc, date: DAY(6) });
    await page.getByRole('button', { name: /Register for this tour/ }).click();
    await expect(page).toHaveURL(/\/registered\/[A-Z2-9]{6}/, { timeout: 30_000 });

    const code = page.url().split('/').pop()!.toUpperCase();
    expect((await getReg(code))?.batch ?? null).toBeNull();
    await expect(page.getByText(/^Batch /)).toHaveCount(0);
  });
});
