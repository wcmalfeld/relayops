import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { withConnection } from "@/server/db/pool";

const noStore = { "cache-control": "no-store" };

/**
 * Liveness check. Distinguishes invalid configuration from an unreachable
 * database. Details go to the server log only; the response stays generic.
 */
export async function GET() {
  try {
    env();
  } catch (e) {
    console.error(`[health] configuration invalid: ${e instanceof Error ? e.message : "unknown error"}`);
    return NextResponse.json({ status: "degraded", config: "invalid" }, { status: 503, headers: noStore });
  }
  try {
    await withConnection((tx) => tx.one("select 1 as ok"));
    return NextResponse.json({ status: "ok", database: "ok" }, { headers: noStore });
  } catch (e) {
    console.error(`[health] database check failed: ${e instanceof Error ? e.name : "unknown error"}`);
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503, headers: noStore });
  }
}
