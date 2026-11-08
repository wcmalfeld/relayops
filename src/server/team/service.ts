import "server-only";
import { z } from "zod";
import { withTenant } from "@/server/db/tenant";
import type { UserContext } from "@/server/auth/types";
import { assertCan } from "@/server/auth/permissions";
import { recordAudit } from "@/server/audit/audit";
import { AppError, conflict, invalid, notFound } from "@/server/errors";
import { hashPassword } from "@/server/auth/password";
import { newSecret, secretHash } from "@/server/auth/tokens";
import { loadBusiness } from "@/server/settings/business";
import { categoryUpdateSchema, settingsFormSchema } from "@/server/settings/schemas";
import { describeAIConfig } from "@/server/ai";

export async function getSettingsData(ctx: UserContext) {
  return withTenant(ctx, async (tx) => {
    const business = await loadBusiness(tx);
    const team = await tx.many<{ membership_id: string; user_id: string; full_name: string; email: string; role: "owner" | "member"; status: string; title: string | null; created_at: Date }>(
      `select m.id as membership_id, m.user_id, p.full_name, p.email, m.role, m.status, m.title, m.created_at
         from business_memberships m join profiles p on p.id = m.user_id order by (m.role = 'owner') desc, p.full_name`,
    );
    const categories = await tx.many<{ id: string; key: string; label: string; description: string; is_enabled: boolean; baseline_manual_minutes: number; assisted_minutes: number; sort_order: number }>(
      "select id, key, label, description, is_enabled, baseline_manual_minutes, assisted_minutes, sort_order from request_categories order by sort_order, label",
    );
    const keys = ctx.role === "owner"
      ? await tx.many<{ id: string; name: string; key_prefix: string; is_enabled: boolean; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }>(
          "select id, name, key_prefix, is_enabled, created_at, last_used_at, revoked_at from integration_settings where kind = 'intake_api_key' order by created_at desc",
        )
      : [];
    return { business, team, categories, keys, ai: describeAIConfig() };
  });
}

export async function updateBusinessSettings(ctx: UserContext, input: unknown) {
  assertCan(ctx, "settings.manage");
  const parsed = settingsFormSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid settings.");
  const d = parsed.data;
  return withTenant(ctx, async (tx) => {
    const business = await loadBusiness(tx);
    const settings = {
      ...business.settings,
      public_intake_enabled: d.public_intake_enabled,
      member_request_visibility: d.member_request_visibility,
      medium_risk_requires_approval: d.medium_risk_requires_approval,
      min_sample_for_metrics: d.min_sample_for_metrics,
      response_sign_off: d.response_sign_off,
      return_window_days: d.return_window_days,
    };
    await tx.exec("update businesses set name = $2, support_email = $3, timezone = $4, settings = $5 where id = $1", [
      ctx.businessId,
      d.name,
      d.support_email || null,
      d.timezone,
      JSON.stringify(settings),
    ]);
    const changed = Object.keys(settings).filter((k) => JSON.stringify((settings as Record<string, unknown>)[k]) !== JSON.stringify((business.settings as Record<string, unknown>)[k]));
    await recordAudit(tx, ctx, {
      eventType: "settings.updated",
      result: "success",
      entityType: "business",
      entityId: ctx.businessId,
      metadata: { changed_settings: changed, name_changed: d.name !== business.name, timezone: d.timezone },
    });
  });
}

export async function updateCategory(ctx: UserContext, input: unknown) {
  assertCan(ctx, "settings.manage");
  const parsed = categoryUpdateSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid category.");
  const d = parsed.data;
  return withTenant(ctx, async (tx) => {
    const n = await tx.exec(
      "update request_categories set label = $2, description = $3, is_enabled = $4, baseline_manual_minutes = $5, assisted_minutes = $6 where id = $1",
      [d.id, d.label, d.description, d.is_enabled, d.baseline_manual_minutes, d.assisted_minutes],
    );
    if (!n) throw notFound("Category not found.");
    await recordAudit(tx, ctx, {
      eventType: "category.updated",
      result: "success",
      entityType: "request_category",
      entityId: d.id,
      metadata: { label: d.label, enabled: d.is_enabled, baseline_minutes: d.baseline_manual_minutes, assisted_minutes: d.assisted_minutes },
    });
  });
}

export const addMemberSchema = z.strictObject({
  full_name: z.string().trim().min(1).max(120),
  email: z.email().max(254).transform((v) => v.toLowerCase()),
  role: z.enum(["owner", "member"]),
  title: z.string().trim().max(80).optional(),
  password: z.string().min(12, "Use at least 12 characters.").max(200),
});

export async function addTeamMember(ctx: UserContext, input: unknown) {
  assertCan(ctx, "team.manage");
  const parsed = addMemberSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid member.");
  const d = parsed.data;
  const hash = await hashPassword(d.password);
  return withTenant(ctx, async (tx) => {
    const existing = await tx.maybeOne(
      "select 1 from business_memberships m join profiles p on p.id = m.user_id where lower(p.email) = $1",
      [d.email],
    );
    if (existing) throw conflict("That person is already a member of this business.");
    const row = await tx.one<{ uid: string }>("select app.admin_add_member($1, $2, $3, $4, $5) as uid", [d.email, d.full_name, hash, d.role, d.title ?? null]);
    await recordAudit(tx, ctx, {
      eventType: "team.member_added",
      result: "success",
      entityType: "profile",
      entityId: row.uid,
      metadata: { role: d.role, has_title: Boolean(d.title) },
    });
  });
}

export const updateMemberSchema = z.strictObject({
  membership_id: z.uuid(),
  role: z.enum(["owner", "member"]),
  status: z.enum(["active", "disabled"]),
});

export async function updateTeamMember(ctx: UserContext, input: unknown) {
  assertCan(ctx, "team.manage");
  const d = updateMemberSchema.parse(input);
  return withTenant(ctx, async (tx) => {
    const m = await tx.maybeOne<{ user_id: string; role: string; status: string }>("select user_id, role, status from business_memberships where id = $1 for update", [d.membership_id]);
    if (!m) throw notFound("Member not found.");
    if (m.user_id === ctx.userId && (d.role !== "owner" || d.status !== "active")) {
      throw new AppError("conflict", "You cannot remove your own owner access. Ask another owner to change it.");
    }
    if (m.role === "owner" && (d.role !== "owner" || d.status !== "active")) {
      const owners = await tx.one<{ n: number }>("select count(*)::int as n from business_memberships where role = 'owner' and status = 'active'");
      if (owners.n <= 1) throw conflict("A business must keep at least one active owner.");
    }
    await tx.exec("update business_memberships set role = $2, status = $3 where id = $1", [d.membership_id, d.role, d.status]);
    await recordAudit(tx, ctx, {
      eventType: "team.member_updated",
      result: "success",
      entityType: "business_membership",
      entityId: d.membership_id,
      metadata: { from_role: m.role, to_role: d.role, from_status: m.status, to_status: d.status, user_id: m.user_id },
    });
  });
}

/** Create an intake API key. The secret is shown once; only its hash is stored. */
export async function createIntakeKey(ctx: UserContext, name: string) {
  assertCan(ctx, "settings.manage");
  const clean = name.trim().slice(0, 80);
  if (!clean) throw invalid("Give the key a name.");
  const secret = `ro_live_${newSecret(24)}`;
  return withTenant(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      `insert into integration_settings (business_id, kind, name, key_prefix, secret_hash, created_by)
       values ($1, 'intake_api_key', $2, $3, $4, $5) returning id`,
      [ctx.businessId, clean, secret.slice(0, 12), secretHash(secret, "api_key"), ctx.userId],
    );
    await recordAudit(tx, ctx, { eventType: "integration.key_created", result: "success", entityType: "integration_setting", entityId: row.id, metadata: { name: clean, prefix: secret.slice(0, 12) } });
    return { id: row.id, secret };
  });
}

export async function revokeIntakeKey(ctx: UserContext, keyId: string) {
  assertCan(ctx, "settings.manage");
  if (!z.uuid().safeParse(keyId).success) throw notFound("Key not found.");
  return withTenant(ctx, async (tx) => {
    const n = await tx.exec("update integration_settings set is_enabled = false, revoked_at = now() where id = $1 and revoked_at is null", [keyId]);
    if (!n) throw notFound("Key not found or already revoked.");
    await recordAudit(tx, ctx, { eventType: "integration.key_revoked", result: "success", entityType: "integration_setting", entityId: keyId });
  });
}
