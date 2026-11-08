import "server-only";
import { z } from "zod";
import type { Tx } from "@/server/db/pool";
import { withTenant } from "@/server/db/tenant";
import type { ActorContext, UserContext } from "@/server/auth/types";
import { assertCan } from "@/server/auth/permissions";
import { recordAudit } from "@/server/audit/audit";
import { AppError, conflict, invalid, notFound } from "@/server/errors";
import { loadBusiness } from "@/server/settings/business";
import { approvalRequiredByRules } from "@/server/rules/engine";
import { syncRequestStatus } from "@/server/requests/status";
import { actionParamSchemas, parseAction, riskFor, type AnyActionParams } from "@/server/actions/registry";
import { loadRequestForAction, validateActionContext } from "@/server/actions/validation";
import type { ActionType, ProposalStatus, RiskLevel } from "@/lib/domain";

export type ProposalRow = {
  id: string;
  business_id: string;
  request_id: string;
  action_type: ActionType;
  params: AnyActionParams;
  params_hash: string;
  original_params: unknown;
  version: number;
  explanation: string;
  evidence_refs: string[];
  unresolved_requirements: string[];
  risk_level: RiskLevel;
  requires_approval: boolean;
  status: ProposalStatus;
  origin: "ai" | "user" | "rule";
  created_by: string | null;
  execution_result: Record<string, unknown> | null;
  failure_reason: string | null;
};

export type CreateProposalInput = {
  requestId: string;
  actionType: unknown;
  params: unknown;
  explanation: string;
  evidenceRefs: string[];
  unresolved: string[];
  claims?: { text: string; basis: "record" | "customer" | "assumption" | "unavailable"; evidence_refs: string[] }[];
  origin: "ai" | "user" | "rule";
  aiRunId?: string | null;
  /** Force the approval gate on (rules may tighten; nothing may loosen). */
  forceApproval?: boolean;
};

export type CreateProposalResult = { proposal: ProposalRow; droppedEvidenceRefs: number };

const uuid = z.uuid();

export async function loadProposal(tx: Tx, proposalId: string, lock = false): Promise<ProposalRow> {
  if (!uuid.safeParse(proposalId).success) throw notFound("Proposal not found.");
  const row = await tx.maybeOne<ProposalRow>(
    `select id, business_id, request_id, action_type, params, params_hash, original_params, version, explanation,
            evidence_refs, unresolved_requirements, risk_level, requires_approval, status, origin, created_by,
            execution_result, failure_reason
       from action_proposals where id = $1 ${lock ? "for update" : ""}`,
    [proposalId],
  );
  if (!row) throw notFound("Proposal not found.");
  return row;
}

/**
 * Validate and persist a proposal. The parameter schema, the business-rule
 * checks, the risk level and the approval requirement are all decided here
 * by application code. Model output contributes only the suggested type,
 * parameters and explanation, all of which are validated.
 */
export async function createProposal(tx: Tx, ctx: ActorContext, input: CreateProposalInput): Promise<CreateProposalResult> {
  if (input.origin === "user") assertCan(ctx, "proposals.create");

  const parsed = parseAction(input.actionType, input.params);
  if (!parsed.ok) {
    throw new AppError("validation", parsed.reason === "unknown_action_type" ? "Unsupported action type." : `Invalid action parameters: ${parsed.issues.join("; ")}`);
  }

  const business = await loadBusiness(tx);
  const req = await loadRequestForAction(tx, input.requestId);
  await validateActionContext(tx, business, req, parsed.actionType, parsed.params, "propose");

  // Evidence must be records the retrieval service actually returned for this request.
  const knownRefs = new Set(
    (await tx.many<{ ref: string }>("select distinct ref from retrieved_records where request_id = $1", [req.id])).map((r) => r.ref),
  );
  const requestedRefs = [...new Set(input.evidenceRefs.filter((r) => typeof r === "string"))].slice(0, 20);
  const evidenceRefs = requestedRefs.filter((r) => knownRefs.has(r));

  const risk = riskFor(parsed.actionType);
  const ruleNames = await approvalRequiredByRules(tx, parsed.actionType, req.category);
  const requiresApproval =
    risk === "high" ||
    (risk === "medium" && business.settings.medium_risk_requires_approval) ||
    Boolean(input.forceApproval) ||
    ruleNames.length > 0;

  const explanation = input.explanation.trim().slice(0, 2000) || "No explanation provided.";
  const unresolved = input.unresolved.map((u) => String(u).trim().slice(0, 300)).filter(Boolean).slice(0, 8);

  const proposal = await tx.one<ProposalRow>(
    `insert into action_proposals
       (business_id, request_id, action_type, params, original_params, explanation, evidence_refs,
        unresolved_requirements, risk_level, requires_approval, origin, ai_run_id, created_by, claims)
     values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning id, business_id, request_id, action_type, params, params_hash, original_params, version, explanation,
               evidence_refs, unresolved_requirements, risk_level, requires_approval, status, origin, created_by,
               execution_result, failure_reason`,
    [
      ctx.businessId,
      req.id,
      parsed.actionType,
      JSON.stringify(parsed.params),
      explanation,
      JSON.stringify(evidenceRefs),
      JSON.stringify(unresolved),
      risk,
      requiresApproval,
      input.origin,
      input.aiRunId ?? null,
      ctx.kind === "user" ? ctx.userId : null,
      JSON.stringify(
        (input.claims ?? []).slice(0, 20).map((c) => ({
          text: String(c.text).slice(0, 300),
          basis: c.basis,
          evidence_refs: c.evidence_refs.filter((r) => knownRefs.has(r)),
        })),
      ),
    ],
  );

  await recordAudit(tx, ctx, {
    eventType: "proposal.created",
    result: "success",
    actorType: input.origin === "ai" ? "ai" : input.origin === "rule" ? "system" : "user",
    requestId: req.id,
    entityType: "action_proposal",
    entityId: proposal.id,
    metadata: {
      action_type: parsed.actionType,
      origin: input.origin,
      risk_level: risk,
      requires_approval: requiresApproval,
      approval_rules: ruleNames,
      evidence_count: evidenceRefs.length,
      dropped_evidence_refs: requestedRefs.length - evidenceRefs.length,
      params_hash: proposal.params_hash,
    },
  });

  return { proposal, droppedEvidenceRefs: requestedRefs.length - evidenceRefs.length };
}

/** A person creates an action directly (for example, a note or an assignment). */
export async function createManualProposal(
  ctx: UserContext,
  input: { requestId: string; actionType: unknown; params: unknown; explanation: string },
) {
  assertCan(ctx, "proposals.create");
  if (!uuid.safeParse(input.requestId).success) throw notFound("Request not found.");
  return withTenant(ctx, async (tx) => {
    const { proposal } = await createProposal(tx, ctx, {
      requestId: input.requestId,
      actionType: input.actionType,
      params: input.params,
      explanation: input.explanation,
      evidenceRefs: [],
      unresolved: [],
      origin: "user",
    });
    await syncRequestStatus(tx, ctx, input.requestId, "proposal_created");
    return proposal;
  });
}

const EDITABLE: ProposalStatus[] = ["draft", "pending_approval", "approved", "failed"];

/**
 * Edit a proposal's parameters. The database trigger bumps the version,
 * returns the proposal to draft and invalidates any prior approval, so an
 * approval can never cover parameters the approver did not see.
 */
export async function editProposal(ctx: UserContext, proposalId: string, input: { params: unknown; expectedVersion: number }) {
  assertCan(ctx, "proposals.edit");
  return withTenant(ctx, async (tx) => {
    const p = await loadProposal(tx, proposalId, true);
    if (!EDITABLE.includes(p.status)) throw conflict(`A ${p.status} proposal can no longer be edited.`);
    if (p.version !== input.expectedVersion) throw conflict("This proposal changed since you opened it. Reload and review it again.");

    const parsed = actionParamSchemas[p.action_type].safeParse(input.params);
    if (!parsed.success) {
      throw invalid("Some values are invalid.", Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "params"), i.message])));
    }
    const params = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as AnyActionParams;

    const business = await loadBusiness(tx);
    const req = await loadRequestForAction(tx, p.request_id);
    await validateActionContext(tx, business, req, p.action_type, params, "propose");

    const activeApprovals = await tx.one<{ n: number }>(
      "select count(*)::int as n from action_approvals where proposal_id = $1 and invalidated_at is null",
      [p.id],
    );
    const updated = await tx.one<{ version: number; params_hash: string; status: ProposalStatus }>(
      `update action_proposals set params = $2, last_edited_by = $3 where id = $1 returning version, params_hash, status`,
      [p.id, JSON.stringify(params), ctx.userId],
    );
    if (updated.params_hash === p.params_hash) {
      return { version: p.version, changed: false };
    }

    const changedFields = Object.keys({ ...(p.params as object), ...(params as object) }).filter(
      (k) => JSON.stringify((p.params as Record<string, unknown>)[k]) !== JSON.stringify((params as Record<string, unknown>)[k]),
    );
    await recordAudit(tx, ctx, {
      eventType: "proposal.edited",
      result: "success",
      requestId: p.request_id,
      entityType: "action_proposal",
      entityId: p.id,
      metadata: { from_version: p.version, to_version: updated.version, changed_fields: changedFields, params_hash: updated.params_hash },
    });
    if (activeApprovals.n > 0) {
      await recordAudit(tx, ctx, {
        eventType: "approval.invalidated",
        result: "info",
        requestId: p.request_id,
        entityType: "action_proposal",
        entityId: p.id,
        metadata: { reason: "parameters_changed", approvals: activeApprovals.n, previous_status: p.status },
      });
    }
    await syncRequestStatus(tx, ctx, p.request_id, "proposal_edited");
    return { version: updated.version, changed: true };
  });
}

export async function submitProposal(ctx: UserContext, proposalId: string, expectedVersion: number) {
  assertCan(ctx, "proposals.submit");
  return withTenant(ctx, async (tx) => {
    const p = await loadProposal(tx, proposalId, true);
    if (!p.requires_approval) throw conflict("This action does not need approval. Execute it directly.");
    if (p.status !== "draft") throw conflict(`A ${p.status.replace("_", " ")} proposal cannot be submitted.`);
    if (p.version !== expectedVersion) throw conflict("This proposal changed since you opened it. Reload and review it again.");

    const business = await loadBusiness(tx);
    const req = await loadRequestForAction(tx, p.request_id);
    await validateActionContext(tx, business, req, p.action_type, p.params, "propose");

    await tx.exec("update action_proposals set status = 'pending_approval', submitted_by = $2, submitted_at = now() where id = $1", [p.id, ctx.userId]);
    await recordAudit(tx, ctx, {
      eventType: "proposal.submitted",
      result: "success",
      requestId: p.request_id,
      entityType: "action_proposal",
      entityId: p.id,
      metadata: { action_type: p.action_type, version: p.version, params_hash: p.params_hash },
    });
    await syncRequestStatus(tx, ctx, p.request_id, "proposal_submitted");
  });
}

export const decisionSchema = z.strictObject({
  decision: z.enum(["approved", "rejected"]),
  expectedVersion: z.number().int().min(1),
  expectedParamsHash: z.string().regex(/^[0-9a-f]{64}$/),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * Record an approval or rejection. The approver's client sends back the
 * version and parameter hash it displayed; if either differs from the stored
 * proposal, the decision is refused so nobody approves parameters they did
 * not see. The database re-checks the approver's role and the binding.
 */
export async function decideProposal(ctx: UserContext, proposalId: string, input: z.input<typeof decisionSchema>) {
  assertCan(ctx, "proposals.decide", "Only an owner can approve or reject proposals.");
  const data = decisionSchema.parse(input);
  return withTenant(ctx, async (tx) => {
    const p = await loadProposal(tx, proposalId, true);
    if (p.version !== data.expectedVersion || p.params_hash !== data.expectedParamsHash) {
      throw conflict("This proposal changed after you opened it. Review the current values before deciding.");
    }
    if (data.decision === "approved" && p.status !== "pending_approval") {
      throw conflict(p.status === "approved" ? "This proposal is already approved." : "Only proposals pending approval can be approved.");
    }
    if (data.decision === "rejected" && !["draft", "pending_approval", "approved"].includes(p.status)) {
      throw conflict("This proposal can no longer be rejected.");
    }

    if (data.decision === "approved") {
      const business = await loadBusiness(tx);
      const req = await loadRequestForAction(tx, p.request_id);
      await validateActionContext(tx, business, req, p.action_type, p.params, "propose");
    }

    const approval = await tx.one<{ id: string }>(
      `insert into action_approvals (business_id, proposal_id, proposal_version, params_hash, decision, decided_by, comment)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [ctx.businessId, p.id, p.version, p.params_hash, data.decision, ctx.userId, data.comment ?? null],
    );
    await tx.exec("update action_proposals set status = $2 where id = $1", [p.id, data.decision]);
    await recordAudit(tx, ctx, {
      eventType: data.decision === "approved" ? "approval.granted" : "approval.rejected",
      result: "success",
      requestId: p.request_id,
      entityType: "action_proposal",
      entityId: p.id,
      metadata: {
        approval_id: approval.id,
        action_type: p.action_type,
        version: p.version,
        params_hash: p.params_hash,
        has_comment: Boolean(data.comment),
      },
    });
    await syncRequestStatus(tx, ctx, p.request_id, `proposal_${data.decision}`);
    return { approvalId: approval.id };
  });
}

export async function cancelProposal(ctx: UserContext, proposalId: string, reason: string) {
  assertCan(ctx, "proposals.cancel");
  const cleanReason = reason.trim().slice(0, 300) || "Dismissed";
  return withTenant(ctx, async (tx) => {
    const p = await loadProposal(tx, proposalId, true);
    if (!["draft", "pending_approval", "approved", "failed"].includes(p.status)) {
      throw conflict(`A ${p.status} proposal cannot be cancelled.`);
    }
    await tx.exec("update action_proposals set status = 'cancelled', cancel_reason = $2 where id = $1", [p.id, cleanReason]);
    await recordAudit(tx, ctx, {
      eventType: "proposal.cancelled",
      result: "success",
      requestId: p.request_id,
      entityType: "action_proposal",
      entityId: p.id,
      metadata: { action_type: p.action_type, previous_status: p.status, reason: cleanReason },
    });
    await syncRequestStatus(tx, ctx, p.request_id, "proposal_cancelled");
  });
}
