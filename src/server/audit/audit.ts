import "server-only";
import type { Tx } from "@/server/db/pool";
import type { ActorContext } from "@/server/auth/types";
import { sanitizeMetadata } from "@/server/audit/sanitize";

export type AuditEventType =
  | "auth.signed_in"
  | "request.created"
  | "request.status_changed"
  | "request.assigned"
  | "request.priority_set"
  | "request.flagged_unresolved"
  | "request.review_required"
  | "ai.processing_started"
  | "ai.processing_completed"
  | "ai.processing_failed"
  | "ai.output_rejected"
  | "classification.corrected"
  | "retrieval.completed"
  | "proposal.created"
  | "proposal.edited"
  | "proposal.submitted"
  | "proposal.cancelled"
  | "proposal.blocked_by_policy"
  | "approval.granted"
  | "approval.rejected"
  | "approval.invalidated"
  | "action.execution_started"
  | "action.executed"
  | "action.execution_failed"
  | "action.execution_denied"
  | "delivery.simulated"
  | "rule.created"
  | "rule.updated"
  | "rule.deleted"
  | "rule.applied"
  | "team.member_added"
  | "team.member_updated"
  | "settings.updated"
  | "category.updated"
  | "integration.key_created"
  | "integration.key_revoked"
  | "record.updated"
  | "intake.rejected";

export type AuditInput = {
  eventType: AuditEventType;
  result: "success" | "failure" | "denied" | "info";
  actorType?: "user" | "system" | "ai" | "public";
  requestId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Append an audit event inside the caller's transaction so the event commits
 * or rolls back together with the change it describes. Failure events that
 * must survive a rollback are written by the caller in a fresh transaction.
 */
export async function recordAudit(tx: Tx, ctx: ActorContext, input: AuditInput) {
  const actorType = input.actorType ?? (ctx.kind === "user" ? "user" : "system");
  // An 'ai' event is still attributed to the user who triggered the run.
  const actorUserId = ctx.kind === "user" ? ctx.userId : null;
  await tx.exec(
    `insert into audit_events (business_id, event_type, actor_type, actor_user_id, request_id, entity_type, entity_id, result, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      ctx.businessId,
      input.eventType,
      actorType,
      actorUserId,
      input.requestId ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      input.result,
      JSON.stringify(sanitizeMetadata(input.metadata ?? {})),
    ],
  );
}
