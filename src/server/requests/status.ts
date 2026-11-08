import "server-only";
import type { Tx } from "@/server/db/pool";
import type { ActorContext } from "@/server/auth/types";
import { recordAudit } from "@/server/audit/audit";
import type { RequestStatus } from "@/lib/domain";

/** Statuses a request may move to from each status via a manual update. */
const MANUAL_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  new: ["needs_review", "completed", "rejected"],
  processing: [],
  needs_review: ["completed", "rejected"],
  awaiting_approval: ["needs_review", "completed", "rejected"],
  approved: ["needs_review", "completed", "rejected"],
  completed: ["needs_review"],
  rejected: ["needs_review"],
  failed: ["needs_review", "completed", "rejected"],
};

export function canTransitionManually(from: RequestStatus, to: RequestStatus) {
  return MANUAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function setRequestStatus(
  tx: Tx,
  ctx: ActorContext,
  requestId: string,
  from: RequestStatus,
  to: RequestStatus,
  reason: string,
  extra?: Record<string, unknown>,
) {
  if (from === to) return;
  const resolved = to === "completed" || to === "rejected";
  await tx.exec(
    `update customer_requests
        set status = $2,
            resolved_at = case when $3 then coalesce(resolved_at, now()) else null end
      where id = $1`,
    [requestId, to, resolved],
  );
  await recordAudit(tx, ctx, {
    eventType: "request.status_changed",
    result: "success",
    requestId,
    entityType: "customer_request",
    entityId: requestId,
    metadata: { from, to, reason, ...extra },
  });
}

/**
 * Derive a request's workflow status from its proposals after a proposal
 * changes state. Terminal statuses set by a person (completed, rejected) are
 * only changed when new proposal activity reopens the request.
 */
export async function syncRequestStatus(tx: Tx, ctx: ActorContext, requestId: string, cause: string) {
  const req = await tx.maybeOne<{ status: RequestStatus; ai_status: string }>(
    "select status, ai_status from customer_requests where id = $1 for update",
    [requestId],
  );
  if (!req || req.status === "processing") return;

  const counts = await tx.one<{
    pending: number;
    approved: number;
    failed: number;
    open_drafts: number;
    sent_responses: number;
  }>(
    `select
        count(*) filter (where status = 'pending_approval')::int as pending,
        count(*) filter (where status = 'approved')::int as approved,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'draft')::int as open_drafts,
        count(*) filter (where status = 'executed' and action_type = 'draft_customer_response')::int as sent_responses
       from action_proposals where request_id = $1`,
    [requestId],
  );

  let next: RequestStatus;
  if (counts.pending > 0) next = "awaiting_approval";
  else if (counts.approved > 0) next = "approved";
  else if (counts.failed > 0) next = "failed";
  else if (counts.sent_responses > 0 && counts.open_drafts === 0) next = "completed";
  else if (req.status === "completed" || req.status === "rejected") return;
  else next = "needs_review";

  await setRequestStatus(tx, ctx, requestId, req.status, next, cause);
}
