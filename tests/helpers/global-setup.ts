import { loadTestEnv } from "./load-env";

/** Rebuild the test database from migrations and the demo seed once per run. */
export default async function setup() {
  loadTestEnv();
  const { dropAll, migrate } = await import("../../scripts/db");
  await dropAll(process.env.DATABASE_ADMIN_URL);
  await migrate(process.env.DATABASE_ADMIN_URL, true);
  const { seed } = await import("../../db/seed/seed");
  const log = console.log;
  console.log = () => undefined;
  try {
    await seed();
  } finally {
    console.log = log;
  }
}
