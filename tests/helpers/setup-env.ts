import { afterAll } from "vitest";
import { loadTestEnv } from "./load-env";

loadTestEnv();

afterAll(async () => {
  const { closePool } = await import("@/server/db/pool");
  await closePool();
});
