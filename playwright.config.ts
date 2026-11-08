import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * End-to-end tests run the real app (Next.js dev server) against the separate
 * test database, which global setup rebuilds from migrations and the demo seed.
 * The AI provider is forced to the deterministic mock, so no credentials or
 * network access are needed.
 */
for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_DATABASE_ADMIN_URL) {
  throw new Error("Set TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL (see .env.example) before running e2e tests.");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use a preinstalled Chromium when provided (e.g. sandboxed CI images);
        // otherwise Playwright's own browser from `npx playwright install`.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `${baseURL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      DATABASE_ADMIN_URL: process.env.TEST_DATABASE_ADMIN_URL,
      APP_URL: baseURL,
      AI_PROVIDER: "mock",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-0123456789abcdefghijklmnop",
    },
  },
});
