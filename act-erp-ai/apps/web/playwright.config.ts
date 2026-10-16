import { defineConfig, devices } from "@playwright/test";

// Load the fake test environment (never real credentials). Values already in
// the shell win, so CI or a developer can override any of them.
process.loadEnvFile(".env.e2e");

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  // One worker: all tests share one seeded database and in-memory rate limits.
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/support/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Fake camera: Chromium feeds a test pattern, so punch photos work.
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
        permissions: ["camera"],
      },
    },
  ],
  webServer: {
    // CI builds and serves the production bundle (catches build errors too).
    // Locally the dev server starts faster and is reused if already running.
    command: isCI
      ? `pnpm build && pnpm exec next start -p ${PORT}`
      : `pnpm exec next dev -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { ...(process.env as Record<string, string>) },
  },
});
