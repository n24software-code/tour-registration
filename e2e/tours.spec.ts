import { expect, test } from '@playwright/test';
import { TOUR_IDS, getTour, patchTour, registerVisitor, signIn, testEmail, adminDb } from './helpers';

const TOUR = TOUR_IDS.sabic;

test.describe('Tours (PM)', () => {
  test('edit pickup point, time and date, then save', async ({ page }) => {
    await signIn(page, 'pm');
    await page.goto('/admin/tours');

    const tour = await getTour(TOUR);
    await page.getByLabel(`Pickup point for ${tour.name}`).fill('Gate 4 - North car park');
    await page.getByLabel(`Departure time for ${tour.name}`).fill('09:45');
    await page.getByLabel(`Date for ${tour.name}`).fill('2026-11-20');

    const row = page.locator('tr', { has: page.getByLabel(`Pickup point for ${tour.name}`) });
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('button', { name: 'Saved' })).toBeVisible();

    await expect.poll(async () => await getTour(TOUR), { timeout: 15_000 }).toMatchObject({
      pickupPoint: 'Gate 4 - North car park',
      departureTime: '09:45',
      date: '2026-11-20',
    });
  });

  test('capacity below registeredCount is blocked', async ({ page }) => {
    // Make sure at least one seat is taken.
    await registerVisitor(page, { name: 'Capacity Guard', email: testEmail(), tourId: TOUR });
    const tour = await getTour(TOUR);
    expect(tour.registeredCount).toBeGreaterThan(0);

    await signIn(page, 'pm');
    await page.goto('/admin/tours');

    const capacity = page.getByLabel(`Capacity for ${tour.name}`);
    const row = page.locator('tr', { has: capacity });
    await capacity.fill(String(tour.registeredCount - 1));

    // The UI blocks it: the field is invalid, Save is disabled, and the minimum is explained.
    await expect(capacity).toHaveAttribute('aria-invalid', 'true');
    await expect(row.getByText(`Min ${tour.registeredCount} (already registered)`)).toBeVisible();
    await expect(row.getByRole('button', { name: 'Save' })).toBeDisabled();

    // And the value was never written.
    expect((await getTour(TOUR)).capacity).toBe(tour.capacity);
  });

  test('closing a tour hides it from the public form choices', async ({ page }) => {
    await signIn(page, 'pm');
    await page.goto('/admin/tours');

    const tour = await getTour(TOUR_IDS.downtown);
    const row = page.locator('tr', { has: page.getByLabel(`Pickup point for ${tour.name}`) });
    await row.getByRole('checkbox').uncheck();
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByRole('button', { name: 'Saved' })).toBeVisible();
    await expect.poll(async () => (await getTour(TOUR_IDS.downtown)).active, { timeout: 15_000 }).toBe(false);

    // The public form now shows it closed and unselectable.
    await page.goto('/');
    const input = page.locator(`input[name="tour"][value="${TOUR_IDS.downtown}"]`);
    await expect(input).toBeDisabled();
    await expect(page.locator('label', { has: input })).toContainText('Registration closed');

    // Reopen it.
    await patchTour(TOUR_IDS.downtown, { active: true });
  });

  test('add a new tour', async ({ page }) => {
    await signIn(page, 'pm');
    await page.goto('/admin/tours');

    const name = `E2E Night Desert Run ${Date.now()}`;
    // Target the add-tour form by id: every table row also has an sr-only "Tour name" label.
    await page.locator('#new-name').fill(name);
    await page.locator('#new-slot').selectOption('evening');
    await page.locator('#new-pickup').fill('Gate 9');
    await page.locator('#new-time').fill('19:30');
    await page.locator('#new-cap').fill('25');
    await page.getByRole('button', { name: 'Add tour' }).click();

    await expect(page.getByLabel(`Pickup point for ${name}`)).toBeVisible({ timeout: 20_000 });

    // The UI already shows the row, but a where() on a brand-new value can lag the index.
    const added = await findTourByName(name);
    expect(added).toBeTruthy();
    expect(added!.data()).toMatchObject({
      name, slot: 'evening', pickupPoint: 'Gate 9', departureTime: '19:30',
      capacity: 25, registeredCount: 0, active: true,
    });

    // It is immediately offered to the public.
    await page.goto('/');
    await expect(page.locator(`input[name="tour"][value="${added!.id}"]`)).toBeEnabled();
  });
});

/** Polls for a tour by name, tolerating brief index lag after a create. */
async function findTourByName(name: string) {
  for (let i = 0; i < 40; i++) {
    const snap = await adminDb().collection('tours').where('name', '==', name).get();
    if (!snap.empty) return snap.docs[0];
    await new Promise((r) => setTimeout(r, 500));
  }
  return undefined;
}
