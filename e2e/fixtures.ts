import { test as base, type Page } from '@playwright/test';

/**
 * Stubs every third-party network call at the network layer so the smoke
 * suite never depends on real backends. Extend the route list as flows are
 * enabled (see smoke.spec.ts).
 */
async function stubBackend(page: Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { user: { id: 'e2e-user', email: 'e2e@example.com' } } }),
  );
  await page.route('**/api/analytics/**', (route) => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/posts/**', (route) => route.fulfill({ json: { id: 'post-1' } }));
  // Catch-all for anything unstubbed so a forgotten endpoint fails loudly in
  // review rather than silently hitting a real third party.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 501, json: { error: 'unstubbed endpoint in e2e run' } }),
  );
}

export const test = base.extend<{ stubbedPage: Page }>({
  stubbedPage: async ({ page }, use) => {
    await stubBackend(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
