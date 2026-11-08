import { withConnection } from "@/server/db/pool";
import { withTenant } from "@/server/db/tenant";
import { buildUserContext } from "@/server/auth/session-service";
import { createRequest } from "@/server/intake/intake-service";
import type { UserContext } from "@/server/auth/types";

export const EMAILS = {
  maya: "owner@summitcycles.example",
  jordan: "service@summitcycles.example",
  priya: "frontdesk@summitcycles.example",
  sam: "owner@harborkayak.example",
} as const;

/** Build a real user context the same way the app does after sign-in. */
export async function ctxFor(who: keyof typeof EMAILS): Promise<UserContext> {
  const row = await withConnection((tx) =>
    tx.one<{ user_id: string }>("select user_id from app.auth_lookup_credentials($1)", [EMAILS[who]]),
  );
  const ctx = await buildUserContext(row.user_id, null);
  if (!ctx) throw new Error(`no context for ${who}`);
  return ctx;
}

let n = 0;
export async function newRequest(ctx: UserContext, overrides: Record<string, unknown> = {}) {
  n++;
  const created = await createRequest(
    ctx,
    {
      customer_name: "Taylor Brooks",
      customer_email: "taylor.brooks@example.com",
      subject: `Where is order SC-10433? (${n})`,
      body: "Hello, has my order SC-10433 shipped yet? Thanks!",
      ...overrides,
    },
    "manual",
  );
  return created.id;
}

export async function proposalsOf(ctx: UserContext, requestId: string) {
  return withTenant(ctx, (tx) =>
    tx.many<{ id: string; action_type: string; status: string; version: number; params_hash: string; params: Record<string, unknown>; requires_approval: boolean; risk_level: string }>(
      "select id, action_type, status, version, params_hash, params, requires_approval, risk_level from action_proposals where request_id = $1 order by created_at",
      [requestId],
    ),
  );
}

export async function auditOf(ctx: UserContext, requestId: string) {
  return withTenant(ctx, (tx) =>
    tx.many<{ event_type: string; result: string; actor_type: string; metadata: Record<string, unknown> }>(
      "select event_type, result, actor_type, metadata from audit_events where request_id = $1 order by created_at, id",
      [requestId],
    ),
  );
}

/** Raw SQL as the restricted runtime role with an arbitrary (possibly forged) context. */
export async function rawAsApp<T>(settings: { actor: string; userId?: string; businessId?: string }, fn: (q: (sql: string, p?: unknown[]) => Promise<T[]>) => Promise<unknown>) {
  return withConnection(async (tx) => {
    await tx.exec("begin");
    try {
      await tx.exec("select set_config('app.actor', $1, true), set_config('app.user_id', $2, true), set_config('app.business_id', $3, true)", [
        settings.actor,
        settings.userId ?? "",
        settings.businessId ?? "",
      ]);
      return await fn((sql, p) => tx.many(sql, p ?? []) as Promise<T[]>);
    } finally {
      await tx.exec("rollback");
    }
  });
}
