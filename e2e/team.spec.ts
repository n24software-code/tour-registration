import { expect, test } from '@playwright/test';
import { CREDS, adminDb, signIn } from './helpers';

test.describe('Team (PO)', () => {
  test('you cannot change your own role or remove yourself', async ({ page }) => {
    await signIn(page, 'po');
    await page.goto('/admin/team');

    const selfRow = page.locator('tr', { hasText: CREDS.po.email });
    await expect(selfRow).toContainText('(you)');
    await expect(selfRow.getByRole('combobox')).toBeDisabled();
    await expect(selfRow.getByRole('button', { name: 'Remove access' })).toHaveCount(0);
  });

  test('change crowd -> registration and back', async ({ page }) => {
    await signIn(page, 'po');
    await page.goto('/admin/team');

    const crowdEmail = CREDS.crowd.email;
    const row = page.locator('tr', { hasText: crowdEmail });
    const select = row.getByRole('combobox');
    await expect(select).toHaveValue('crowd');

    await select.selectOption('registration');
    await expect.poll(async () => await roleOf(crowdEmail), { timeout: 20_000 }).toBe('registration');

    // Always put it back, so the rest of the suite still has a crowd account.
    await select.selectOption('crowd');
    await expect.poll(async () => await roleOf(crowdEmail), { timeout: 20_000 }).toBe('crowd');
  });

  test('the PO and PM rows are never modified by this suite', async ({ page }) => {
    await signIn(page, 'po');
    await page.goto('/admin/team');

    // PM is a real staff account: it must still be a pm, and still present.
    await expect(page.locator('tr', { hasText: CREDS.pm.email }).getByRole('combobox'))
      .toHaveValue('pm');
    expect(await roleOf(CREDS.po.email)).toBe('po');
    expect(await roleOf(CREDS.pm.email)).toBe('pm');
  });

  test('add a member, then remove their access (they then see "No team role yet")', async ({ page, browser }) => {
    const email = `e2e-member-${Date.now()}@tour.test`;
    const password = 'TempPassword123!';

    await signIn(page, 'po');
    await page.goto('/admin/team');

    await page.locator('#m-name').fill('E2E Temp Member');
    await page.locator('#m-email').fill(email);
    await page.locator('#m-role').selectOption('registration');
    await page.locator('#m-password').fill(password);
    await page.getByRole('button', { name: 'Add member' }).click();

    await expect(page.getByRole('status')).toContainText('E2E Temp Member added');
    await expect(page.locator('tr', { hasText: email })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => await roleOf(email), { timeout: 20_000 }).toBe('registration');

    // Remove their access.
    page.once('dialog', (d) => d.accept());
    await page.locator('tr', { hasText: email }).getByRole('button', { name: 'Remove access' }).click();
    await expect(page.locator('tr', { hasText: email })).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(async () => await roleOf(email), { timeout: 20_000 }).toBeUndefined();

    // That user now sees the no-role message.
    const ctx = await browser.newContext();
    const theirs = await ctx.newPage();
    await theirs.goto('/login');
    await theirs.getByLabel('Email').fill(email);
    await theirs.getByLabel('Password').fill(password);
    await theirs.getByRole('button', { name: 'Sign in' }).click();
    await expect(theirs.getByRole('heading', { name: 'No team role yet' })).toBeVisible({ timeout: 20_000 });
    await expect(theirs.getByText(email, { exact: false })).toBeVisible();
    await ctx.close();

    // The throwaway login is removed in global-teardown, so a mid-test failure
    // cannot leak it.
  });
});

/** The role on record for an email, or undefined once their access is removed. */
async function roleOf(email: string) {
  const { data } = await adminDb()
    .from('admins').select('role').eq('email', email.toLowerCase()).maybeSingle();
  return (data?.role as string | undefined) ?? undefined;
}
