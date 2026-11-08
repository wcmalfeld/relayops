import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { runUnresolvedCheckForAllBusinesses } from "@/server/rules/engine";

/** Scheduled unresolved-request check (see vercel.json). */
export async function GET(request: NextRequest) {
  const secret = env().CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runUnresolvedCheckForAllBusinesses();
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
