import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.ZBSEARCH_E2E_DEV_PORT ?? 3210)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry'
  },
  projects: [{ name: 'development', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec docusaurus start --port ${PORT} --no-open`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'pipe'
  }
})
