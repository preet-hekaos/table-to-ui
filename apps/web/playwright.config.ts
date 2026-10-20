import { defineConfig, devices } from '@playwright/test'

/** E2E runs against a real API and database. Start them first (see README) or set BASE_URL. */
export default defineConfig({
  testDir: './e2e',
  testIgnore: process.env.SCREENSHOTS ? [] : ['**/screenshots.spec.ts'], // documentation captures, run on demand
  timeout: 240_000, // the demo is one long scenario; a cold CI runner compiles pages on first visit
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined } } }],
})
