import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke suite config (FE-124). Runs against the Vite dev server with the
 * backend stubbed at the network layer (see e2e/fixtures.ts) — no real
 * third-party calls. See docs/performance-budget.md's sibling doc for the
 * flake policy: a test that passes on retry is reported as flaky, never
 * silently swallowed.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github'], ['list']]
    : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
