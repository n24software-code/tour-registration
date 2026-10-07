import { expect, test, type Page } from '@playwright/test';
import { CREDS, LOGO_ALTS, adminDocFor, type Role, signIn } from './helpers';

// Mirrors lib/roles.ts exactly. If these drift, the app and the matrix disagree.
const NAV_FOR: Record<Role, string[]> = {
  po: ['Overview', 'Registrations', 'Pickup & boarding', 'Tours', 'Team'],
  pm: ['Overview', 'Registrations', 'Pickup & boarding', 'Tours'],
  registration: ['Overview', 'Registrations'],
  crowd: ['Overview', 'Pickup & boarding'],
};

const ROLE_LABEL: Record<Role, string> = {
  po: 'Product Owner', pm: 'Project Manager',
  registration: 'Registration team', crowd: 'Crowd team',
};

const PAGES: { href: string; label: string }[] = [
  { href: '/admin/registrations', label: 'Registrations' },
  { href: '/admin/crowd', label: 'Pickup & boarding' },
  { href: '/admin/tours', label: 'Tours' },
  { href: '/admin/team', label: 'Team' },
];

const navLinks = (page: Page) => page.getByRole('navigation', { name: 'Admin' }).getByRole('link');

test.describe('Auth and roles', () => {
  test('signed-out /admin redirects to /login', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Team sign in' })).toBeVisible();
  });

  test('a wrong password shows a clear error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(CREDS.po.email);
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Scope to the form's own alert: Next.js adds a route-announcer with role="alert".
    await expect(page.locator('form p[role="alert"]'))
      .toHaveText('Email or password is incorrect. Check both and try again.');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('empty fields are caught before any network call', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('form p[role="alert"]')).toHaveText('Enter your email and password.');
  });

  for (const role of Object.keys(NAV_FOR) as Role[]) {
    test(`${role}: nav matches lib/roles.ts, header shows name + role + Sign out`, async ({ page }) => {
      await signIn(page, role);

      // Header identity - the name comes from the real admins doc.
      const { name } = await adminDocFor(role);
      await expect(page.getByText(name, { exact: true })).toBeVisible();
      await expect(page.getByText(ROLE_LABEL[role], { exact: false })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
      // The partner logos sit in the admin header too, at the smaller size.
      await expect(page.locator('header').getByAltText(LOGO_ALTS[0], { exact: true })).toBeVisible();

      // Nav is exactly the permitted set, in order.
      await expect(navLinks(page)).toHaveText(NAV_FOR[role]);
    });

    test(`${role}: forbidden URLs show the "not available to your role" message`, async ({ page }) => {
      await signIn(page, role);
      const allowed = new Set(NAV_FOR[role]);

      for (const { href, label } of PAGES) {
        await page.goto(href);
        if (allowed.has(label)) {
          await expect(page.getByRole('heading', { name: /isn’t available to your role/ })).toHaveCount(0);
        } else {
          await expect(page.getByRole('heading', { name: 'This page isn’t available to your role' })).toBeVisible();
          await expect(page.getByText(`${ROLE_LABEL[role]} accounts can’t open ${label}.`)).toBeVisible();
        }
      }
    });
  }

  test('sign out returns to /login and /admin is protected again', async ({ page }) => {
    await signIn(page, 'po');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login$/);
  });
});
