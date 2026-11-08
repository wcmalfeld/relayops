import type { ActorContext, Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Server-side permission model. The UI hides controls using the same table,
 * but every service function checks permissions again before acting.
 * The AI layer has no actor identity and therefore holds no permissions.
 */
export const PERMISSIONS = {
  "requests.view_all": ["owner"],
  "requests.create": ["owner", "member"],
  "requests.process": ["owner", "member"],
  "requests.correct_classification": ["owner", "member"],
  "proposals.create": ["owner", "member"],
  "proposals.edit": ["owner", "member"],
  "proposals.submit": ["owner", "member"],
  "proposals.decide": ["owner"],
  "proposals.execute_medium": ["owner", "member"],
  "proposals.execute_approved": ["owner", "member"],
  "proposals.cancel": ["owner", "member"],
  "records.update_operational": ["owner", "member"],
  "records.manage": ["owner"],
  "rules.manage": ["owner"],
  "team.manage": ["owner"],
  "settings.manage": ["owner"],
  "audit.view_all": ["owner"],
  "metrics.view": ["owner", "member"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(ctx: ActorContext | null | undefined, permission: Permission): boolean {
  if (!ctx || ctx.kind !== "user") return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(ctx.role);
}

export function assertCan(ctx: ActorContext, permission: Permission, message?: string): asserts ctx is Extract<ActorContext, { kind: "user" }> {
  if (!can(ctx, permission)) {
    throw forbidden(message ?? "Your role does not allow this action.");
  }
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => (PERMISSIONS[p] as readonly Role[]).includes(role));
}
