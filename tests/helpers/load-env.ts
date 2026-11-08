import { existsSync } from "node:fs";

/** Load .env.local/.env and point the app at the test database. */
export function loadTestEnv() {
  for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
  const url = process.env.TEST_DATABASE_URL;
  const admin = process.env.TEST_DATABASE_ADMIN_URL;
  if (!url || !admin) throw new Error("Set TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL (see .env.example).");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url && !process.env.__RELAYOPS_TEST_ENV) {
    const dev = new URL(process.env.DATABASE_URL).pathname;
    if (new URL(url).pathname === dev) throw new Error("TEST_DATABASE_URL must point at a different database than DATABASE_URL.");
  }
  process.env.__RELAYOPS_TEST_ENV = "1";
  process.env.DATABASE_URL = url;
  process.env.DATABASE_ADMIN_URL = admin;
  process.env.AI_PROVIDER = "mock";
  process.env.AUTH_SECRET ??= "test-only-secret-0123456789abcdefghijklmnop";
  process.env.AI_MAX_RETRIES = "1";
}
