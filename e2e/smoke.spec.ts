import { test, expect } from './fixtures';

/**
 * Smoke suite (FE-124). Each flow is `test.fixme` until the corresponding
 * page lands in this branch (the UI layer was removed for a rebuild — see
 * `chore/frontend-reset`); flip to a real test against that page's
 * data-testid hooks as it's built, rather than deleting the scaffold.
 *
 * Flake policy: rely on playwright.config.ts's `retries: 1` in CI plus the
 * `github`/`html` reporters — a test that fails then passes on retry shows
 * up as flaky in both, it is never silently reported as a clean pass.
 */

test.fixme('sign in → lands on analytics', async ({ stubbedPage: page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('e2e@example.com');
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/analytics/);
});

test.fixme('compose and schedule a post', async ({ stubbedPage: page }) => {
  await page.goto('/compose');
  await page.getByRole('textbox', { name: /post content/i }).fill('Hello world');
  await page.getByRole('button', { name: /schedule/i }).click();
  await expect(page.getByText(/scheduled/i)).toBeVisible();
});

test.fixme('change the analytics date range', async ({ stubbedPage: page }) => {
  await page.goto('/analytics');
  await page.getByRole('button', { name: /date range/i }).click();
  await page.getByRole('option', { name: /last 30 days/i }).click();
  await expect(page.getByTestId('analytics-range-label')).toHaveText(/last 30 days/i);
});

test.fixme('open and save a settings section', async ({ stubbedPage: page }) => {
  await page.goto('/settings');
  await page.getByRole('link', { name: /notifications/i }).click();
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(/saved/i)).toBeVisible();
});

test.fixme('sign out', async ({ stubbedPage: page }) => {
  await page.goto('/analytics');
  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
});
