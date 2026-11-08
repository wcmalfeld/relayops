import { execFileSync } from "node:child_process";

/**
 * Rebuild the test database (drop, migrate, seed Summit Cycles) before the run.
 * Runs the same script as `npm run db:reset`, pointed at the test database.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  const admin = process.env.TEST_DATABASE_ADMIN_URL;
  if (!url || !admin) throw new Error("Set TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL.");
  if (process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === new URL(url).pathname) {
    throw new Error("TEST_DATABASE_URL must point at a different database than DATABASE_URL.");
  }
  execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/db.ts", "reset"], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, DATABASE_URL: url, DATABASE_ADMIN_URL: admin, AI_PROVIDER: "mock" },
  });
}
