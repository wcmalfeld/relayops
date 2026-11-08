export type Role = "owner" | "member";

/** An authenticated person acting within one business. Built server-side only. */
export type UserContext = {
  kind: "user";
  userId: string;
  businessId: string;
  businessName: string;
  businessSlug: string;
  role: Role;
  email: string;
  fullName: string;
};

/**
 * A server process acting for a business without a signed-in user, such as
 * public form intake, API intake, or the scheduled unresolved-request check.
 * System contexts can create requests and run workflow rules; they can never
 * approve or execute proposals (see actions/permissions).
 */
export type SystemContext = {
  kind: "system";
  businessId: string;
  source: "public_intake" | "api_intake" | "scheduler";
};

export type ActorContext = UserContext | SystemContext;

export function actorUserId(ctx: ActorContext): string | null {
  return ctx.kind === "user" ? ctx.userId : null;
}
