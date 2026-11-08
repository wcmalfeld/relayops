import "server-only";
import { z } from "zod";
import { withConnection } from "@/server/db/pool";
import { withUserScope, withTenant } from "@/server/db/tenant";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { DUMMY_HASH, verifyPassword } from "@/server/auth/password";
import { newSecret, secretHash } from "@/server/auth/tokens";
import { hitRateLimit } from "@/server/http/rate-limit";
import { recordAudit } from "@/server/audit/audit";
import type { Role, UserContext } from "@/server/auth/types";

export const loginSchema = z.strictObject({
  email: z.email("Enter a valid email address.").max(254).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, "Enter your password.").max(200),
});

export type SessionInfo = {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  activeBusinessId: string | null;
  expiresAt: Date;
};

export type MembershipSummary = {
  businessId: string;
  businessName: string;
  businessSlug: string;
  role: Role;
};

const GENERIC_LOGIN_ERROR = "Email or password is incorrect.";

export async function login(
  input: unknown,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("validation", "Enter a valid email and password.");
  }
  const { email, password } = parsed.data;

  const ipKey = meta.ip ? secretHash(meta.ip, "ip") : "unknown";
  const limit = env().LOGIN_ATTEMPTS_PER_15_MIN;
  const [byEmail, byIp] = await Promise.all([
    hitRateLimit(`login:email:${secretHash(email, "ip")}`, limit, 900),
    hitRateLimit(`login:ip:${ipKey}`, limit * 5, 900),
  ]);
  if (!byEmail.allowed || !byIp.allowed) {
    throw new AppError("rate_limited", "Too many sign-in attempts. Wait a few minutes and try again.");
  }

  const cred = await withConnection((tx) =>
    tx.maybeOne<{ user_id: string; password_hash: string; is_active: boolean }>(
      "select * from app.auth_lookup_credentials($1)",
      [email],
    ),
  );

  const ok = await verifyPassword(password, cred?.password_hash ?? DUMMY_HASH);
  if (!cred || !ok || !cred.is_active) {
    throw new AppError("unauthenticated", GENERIC_LOGIN_ERROR);
  }

  const token = newSecret(32);
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600_000);
  await withConnection((tx) =>
    tx.one("select app.auth_create_session($1, $2, $3, $4, $5) as id", [
      cred.user_id,
      secretHash(token, "session"),
      expiresAt,
      meta.userAgent ?? null,
      meta.ip ? ipKey : null,
    ]),
  );

  const ctx = await buildUserContext(cred.user_id, null);
  if (ctx) {
    await withTenant(ctx, (tx) =>
      recordAudit(tx, ctx, { eventType: "auth.signed_in", result: "success", entityType: "profile", entityId: ctx.userId }),
    );
  }
  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined | null): Promise<SessionInfo | null> {
  if (!token || token.length > 200) return null;
  const row = await withConnection((tx) =>
    tx.maybeOne<{
      session_id: string;
      user_id: string;
      email: string;
      full_name: string;
      active_business_id: string | null;
      expires_at: Date;
    }>("select * from app.auth_resolve_session($1)", [secretHash(token, "session")]),
  );
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    activeBusinessId: row.active_business_id,
    expiresAt: row.expires_at,
  };
}

export async function logout(token: string | undefined | null) {
  if (!token) return;
  await withConnection((tx) => tx.exec("select app.auth_revoke_session($1)", [secretHash(token, "session")]));
}

export async function listMemberships(userId: string): Promise<MembershipSummary[]> {
  return withUserScope(userId, async (tx) => {
    const rows = await tx.many<{ business_id: string; name: string; slug: string; role: Role }>(
      `select m.business_id, b.name, b.slug, m.role
         from business_memberships m join businesses b on b.id = m.business_id
        where m.user_id = $1 and m.status = 'active'
        order by b.name`,
      [userId],
    );
    return rows.map((r) => ({ businessId: r.business_id, businessName: r.name, businessSlug: r.slug, role: r.role }));
  });
}

/**
 * Build the authoritative user context. The business is the session's active
 * business if the user is still an active member; otherwise their first
 * business. Role comes from the membership row, never from the client.
 */
export async function buildUserContext(userId: string, activeBusinessId: string | null): Promise<UserContext | null> {
  return withUserScope(userId, async (tx) => {
    const rows = await tx.many<{
      business_id: string;
      name: string;
      slug: string;
      role: Role;
      email: string;
      full_name: string;
    }>(
      `select m.business_id, b.name, b.slug, m.role, p.email, p.full_name
         from business_memberships m
         join businesses b on b.id = m.business_id
         join profiles p on p.id = m.user_id
        where m.user_id = $1 and m.status = 'active' and p.is_active
        order by (m.business_id = $2) desc, (m.role = 'owner') desc, b.name
        limit 1`,
      [userId, activeBusinessId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      kind: "user",
      userId,
      businessId: r.business_id,
      businessName: r.name,
      businessSlug: r.slug,
      role: r.role,
      email: r.email,
      fullName: r.full_name,
    } satisfies UserContext;
  });
}

export async function switchActiveBusiness(token: string, businessId: string) {
  if (!z.uuid().safeParse(businessId).success) throw new AppError("validation", "Unknown business.");
  const row = await withConnection((tx) =>
    tx.one<{ ok: boolean }>("select app.auth_set_active_business($1, $2) as ok", [secretHash(token, "session"), businessId]),
  );
  if (!row.ok) throw new AppError("forbidden", "You are not a member of that business.");
}
