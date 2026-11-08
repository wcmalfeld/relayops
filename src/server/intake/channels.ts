import "server-only";
import { withConnection } from "@/server/db/pool";
import { secretHash } from "@/server/auth/tokens";
import type { SystemContext } from "@/server/auth/types";

/** Public form: the business comes from a server-side slug lookup, and only if public intake is enabled. */
export async function publicIntakeContext(slug: string): Promise<{ ctx: SystemContext; businessName: string } | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return null;
  const row = await withConnection((tx) =>
    tx.maybeOne<{ business_id: string; business_name: string }>("select * from app.resolve_public_business($1)", [slug]),
  );
  if (!row) return null;
  return { ctx: { kind: "system", businessId: row.business_id, source: "public_intake" }, businessName: row.business_name };
}

/** Intake API: the business is whichever business owns the presented key. */
export async function apiKeyContext(authorization: string | null): Promise<SystemContext | null> {
  const match = authorization?.match(/^Bearer\s+(ro_live_[A-Za-z0-9_-]{20,64})$/);
  if (!match) return null;
  const row = await withConnection((tx) =>
    tx.maybeOne<{ business_id: string | null }>("select app.resolve_intake_api_key($1) as business_id", [secretHash(match[1], "api_key")]),
  );
  if (!row?.business_id) return null;
  return { kind: "system", businessId: row.business_id, source: "api_intake" };
}
