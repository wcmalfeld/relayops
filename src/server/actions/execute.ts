import "server-only";
import { withTenant } from "@/server/db/tenant";
import type { ActorContext, UserContext } from "@/server/auth/types";
import { assertCan, can } from "@/server/auth/permissions";
import { recordAudit } from "@/server/audit/audit";
import { AppError, conflict, errorSummary, forbidden, toAppError } from "@/server/errors";
import { loadBusiness } from "@/server/settings/business";
import { syncRequestStatus } from "@/server/requests/status";
import { actionParamSchemas } from "@/server/actions/registry";
import { loadRequestForAction, validateActionContext } from "@/server/actions/validation";
import { loadProposal } from "@/server/actions/proposals";
import { handlers } from "@/server/actions/handlers";

export type ExecutionOutcome =
  | { status: "executed"; summary: string; details?: Record<string, unknown> }
  | { status: "failed"; reason: string };

/**
 * Execute one approved (or approval-free) proposal.
 *
 * Guarantees:
 *  - Only a signed-in person with the right permission can execute. System
 *    processes and the AI pipeline have no path into this function.
 *  - The proposal row is locked (SELECT ... FOR UPDATE) for the whole
 *    transaction, so concurrent attempts serialize; the loser sees the new
 *    status and is refused.
 *  - The database trigger refuses the move to 'executing' unless a valid
 *    approval matches the current version and parameter hash.
 *  - A unique index allows at most one successful execution per proposal.
 *  - Parameters are re-validated against current records just before the
 *    handler runs. The handler, the status change, the execution record and
 *    the audit event commit together or not at all.
 *  - If the handler fails, the transaction rolls back and the failure is
 *    recorded in a separate transaction.
 */
export async function executeProposal(ctx: ActorContext, proposalId: string, expectedVersion: number): Promise<ExecutionOutcome> {
  if (ctx.kind !== "user") {
    throw forbidden("Only a signed-in team member can execute actions.");
  }
  const user: UserContext = ctx;
  let stage: "checks" | "handler" = "checks";
  let requestIdForAudit: string | null = null;

  try {
    return await withTenant(user, async (tx) => {
      const p = await loadProposal(tx, proposalId, true);
      requestIdForAudit = p.request_id;

      if (p.status === "executed") throw conflict("This action was already executed. It will not run twice.");
      if (p.status === "executing") throw conflict("This action is already being executed.");
      if (p.version !== expectedVersion) throw conflict("This proposal changed since you opened it. Review it again before executing.");

      if (p.requires_approval) {
        assertCan(user, "proposals.execute_approved");
        if (p.status !== "approved" && p.status !== "failed") {
          throw conflict(p.status === "pending_approval" ? "This action is waiting for approval." : "This action needs an approval before it can run.");
        }
      } else {
        assertCan(user, "proposals.execute_medium");
        if (p.status !== "draft" && p.status !== "failed") throw conflict(`A ${p.status} action cannot be executed.`);
      }

      // Re-validate against the strict schema and the current state of records.
      const reparsed = actionParamSchemas[p.action_type].safeParse(p.params);
      if (!reparsed.success) throw new AppError("validation", "Stored parameters failed validation; the action was not executed.");
      const business = await loadBusiness(tx);
      const req = await loadRequestForAction(tx, p.request_id, true);

      // The trigger enforces the approval binding at this transition.
      await tx.exec("update action_proposals set status = 'executing' where id = $1", [p.id]);
      await recordAudit(tx, user, {
        eventType: "action.execution_started",
        result: "info",
        requestId: p.request_id,
        entityType: "action_proposal",
        entityId: p.id,
        metadata: { action_type: p.action_type, version: p.version, params_hash: p.params_hash },
      });

      stage = "handler";
      await validateActionContext(tx, business, req, p.action_type, p.params, "execute");
      const result = await handlers[p.action_type](tx, user, p, req, business);

      await tx.exec(
        `update action_proposals
            set status = 'executed', executed_by = $2, executed_at = now(), execution_result = $3, failure_reason = null
          where id = $1`,
        [p.id, user.userId, JSON.stringify({ summary: result.summary, ...result.details })],
      );
      await tx.exec(
        `insert into workflow_executions (business_id, kind, proposal_id, proposal_version, request_id, status, idempotency_key, detail, actor_user_id, finished_at)
         values ($1, 'proposal', $2, $3, $4, 'succeeded', $5, $6, $7, now())`,
        [user.businessId, p.id, p.version, p.request_id, `proposal:${p.id}`, JSON.stringify({ action_type: p.action_type, ...result.details }), user.userId],
      );
      await recordAudit(tx, user, {
        eventType: "action.executed",
        result: "success",
        requestId: p.request_id,
        entityType: "action_proposal",
        entityId: p.id,
        metadata: { action_type: p.action_type, version: p.version, params_hash: p.params_hash, summary: result.summary, ...result.details },
      });
      if (!result.statusHandled) await syncRequestStatus(tx, user, p.request_id, "action_executed");
      return { status: "executed" as const, summary: result.summary, details: result.details };
    });
  } catch (err) {
    const appErr = toAppError(err);
    if (stage === "checks") {
      // Refused before anything ran: nothing to roll forward, record the denial.
      if (requestIdForAudit && (appErr.code === "forbidden" || appErr.code === "conflict")) {
        await recordDenial(user, proposalId, requestIdForAudit, appErr).catch(() => undefined);
      }
      throw appErr;
    }
    if (appErr.code === "internal") console.error("[relayops] action execution failed", errorSummary(err));
    await recordFailure(user, proposalId, appErr.message);
    return { status: "failed", reason: appErr.message };
  }
}

async function recordDenial(ctx: UserContext, proposalId: string, requestId: string, err: AppError) {
  await withTenant(ctx, (tx) =>
    recordAudit(tx, ctx, {
      eventType: "action.execution_denied",
      result: "denied",
      requestId,
      entityType: "action_proposal",
      entityId: proposalId,
      metadata: { code: err.code, reason: err.message },
    }),
  );
}

async function recordFailure(ctx: UserContext, proposalId: string, reason: string) {
  await withTenant(ctx, async (tx) => {
    const p = await loadProposal(tx, proposalId, true);
    if (p.status === "approved" || p.status === "draft" || p.status === "failed") {
      // Record the attempt: approved -> executing -> failed, within one transaction.
      await tx.exec("update action_proposals set status = 'executing' where id = $1", [p.id]);
      await tx.exec("update action_proposals set status = 'failed', failure_reason = $2 where id = $1", [p.id, reason.slice(0, 500)]);
    }
    await tx.exec(
      `insert into workflow_executions (business_id, kind, proposal_id, proposal_version, request_id, status, idempotency_key, detail, actor_user_id, finished_at)
       values ($1, 'proposal', $2, $3, $4, 'failed', $5, $6, $7, now())`,
      [ctx.businessId, p.id, p.version, p.request_id, `proposal:${p.id}:${Date.now()}`, JSON.stringify({ reason: reason.slice(0, 200) }), ctx.userId],
    );
    await recordAudit(tx, ctx, {
      eventType: "action.execution_failed",
      result: "failure",
      requestId: p.request_id,
      entityType: "action_proposal",
      entityId: p.id,
      metadata: { action_type: p.action_type, version: p.version, reason },
    });
    await syncRequestStatus(tx, ctx, p.request_id, "action_failed");
  });
}

export function canExecute(ctx: UserContext, p: { requires_approval: boolean; status: string }) {
  if (p.requires_approval) return can(ctx, "proposals.execute_approved") && (p.status === "approved" || p.status === "failed");
  return can(ctx, "proposals.execute_medium") && (p.status === "draft" || p.status === "failed");
}
