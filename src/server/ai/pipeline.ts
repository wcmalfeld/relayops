import "server-only";
import { z } from "zod";
import type { Tx } from "@/server/db/pool";
import { withTenant } from "@/server/db/tenant";
import type { ActorContext } from "@/server/auth/types";
import { assertCan } from "@/server/auth/permissions";
import { recordAudit } from "@/server/audit/audit";
import { AppError, conflict, notFound } from "@/server/errors";
import { env } from "@/server/env";
import { hitRateLimit } from "@/server/http/rate-limit";
import { loadBusiness, type BusinessRecord } from "@/server/settings/business";
import { getAIService } from "@/server/ai";
import { AIError, PROMPT_VERSION, type AIResult, type AIService, type AITask } from "@/server/ai/service";
import {
  classificationOutputSchema,
  draftOutputSchema,
  proposalOutputSchema,
  summaryOutputSchema,
  type CategoryOption,
  type ClassificationOutput,
  type DraftOutput,
  type ProposalOutput,
  type RequestText,
  type SummaryOutput,
} from "@/server/ai/schemas";
import { checkGrounding, detectInjectionSignals, truncateForModel } from "@/server/ai/guards";
import { getRetrievalService, saveEvidence, type RetrievalResult } from "@/server/retrieval/retrieval-service";
import { createProposal } from "@/server/actions/proposals";
import { ACTION_DESCRIPTIONS, AI_PROPOSABLE_ACTIONS, actionParamSchemas, isActionType } from "@/server/actions/registry";
import { runRequestClassifiedRules } from "@/server/rules/engine";
import { setRequestStatus } from "@/server/requests/status";
import type { RequestStatus } from "@/lib/domain";

export type ProcessingOutcome = {
  status: "completed" | "failed";
  category: string | null;
  proposalsCreated: number;
  proposalsBlocked: number;
  reviewReasons: string[];
  errorCode?: string;
};

type LoadedRequest = {
  id: string;
  reference: string;
  status: RequestStatus;
  subject: string;
  body: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  received_at: Date;
  ai_status: string;
  updated_at: Date;
};

const PROCESSABLE: RequestStatus[] = ["new", "needs_review", "failed", "processing"];

/**
 * Run AI-assisted processing for one request:
 * validate -> classify -> summarize -> retrieve records -> draft -> propose
 * -> validate everything server-side -> persist for human review.
 *
 * Model calls happen outside database transactions. If the provider fails at
 * any step, whatever succeeded is kept, the request is flagged for manual
 * handling, and the rest of the product keeps working.
 */
export async function processRequest(ctx: ActorContext, requestId: string, ai: AIService = getAIService()): Promise<ProcessingOutcome> {
  if (ctx.kind === "user") assertCan(ctx, "requests.process");
  if (!z.uuid().safeParse(requestId).success) throw notFound("Request not found.");

  // 1. Claim the request (prevents concurrent double processing).
  const claimed = await withTenant(ctx, async (tx) => {
    const req = await tx.maybeOne<LoadedRequest>(
      `select id, reference, status, subject, body, customer_id, customer_name, customer_email, received_at, ai_status, updated_at
         from customer_requests where id = $1 for update`,
      [requestId],
    );
    if (!req) throw notFound("Request not found.");
    if (req.ai_status === "processing" && Date.now() - new Date(req.updated_at).getTime() < 120_000) {
      throw conflict("This request is already being processed.");
    }
    if (!PROCESSABLE.includes(req.status)) {
      throw conflict("Requests with proposals awaiting approval, approved actions, or a final status cannot be reprocessed.");
    }
    const business = await loadBusiness(tx);
    const categories = await tx.many<CategoryOption>(
      "select key, label, description from request_categories where is_enabled order by sort_order, label",
    );
    const team = await tx.many<{ user_id: string; name: string; title: string | null }>(
      `select m.user_id, p.full_name as name, m.title from business_memberships m join profiles p on p.id = m.user_id
        where m.status = 'active' and p.is_active order by p.full_name`,
    );
    await tx.exec("update customer_requests set ai_status = 'processing', ai_error_code = null where id = $1", [req.id]);
    await setRequestStatus(tx, ctx, req.id, req.status, "processing", "ai_processing_started");
    await recordAudit(tx, ctx, {
      eventType: "ai.processing_started",
      result: "info",
      actorType: "ai",
      requestId: req.id,
      entityType: "customer_request",
      entityId: req.id,
      metadata: { provider: ai.provider, model: ai.model, prompt_version: PROMPT_VERSION },
    });
    return { req, business, categories, team };
  });

  const { req, business, categories, team } = claimed;
  const runs: RunRecord[] = [];

  // 2. Rate limit model usage per business.
  const limit = await hitRateLimit(`ai:${ctx.businessId}`, env().AI_RUNS_PER_HOUR, 3600);
  if (!limit.allowed) {
    return finishFailed(ctx, req, runs, "rate_limited", ai);
  }

  const { text: body, truncated } = truncateForModel(req.body, env().AI_MAX_INPUT_CHARS);
  const requestText: RequestText = {
    reference: req.reference,
    subject: req.subject,
    body,
    customerName: req.customer_name,
    customerMatched: Boolean(req.customer_id),
    receivedAt: new Date(req.received_at).toISOString(),
  };
  const serverInjectionSignals = detectInjectionSignals(`${req.subject}\n${req.body}`);

  // 3. Classify.
  const classification = await callTask(ai, "classify", runs, () => ai.classify({ request: requestText, categories }), classificationOutputSchema);
  if (!classification.ok) return finishFailed(ctx, req, runs, classification.code, ai);
  const cls: ClassificationOutput = {
    ...classification.value,
    category: categories.some((c) => c.key === classification.value.category) ? classification.value.category : "other",
    injection_suspected: classification.value.injection_suspected || serverInjectionSignals.length > 0,
  };

  // 4. Summarize (failure here is not fatal).
  const summary = await callTask(ai, "summarize", runs, () => ai.summarize({ request: requestText, category: cls.category }), summaryOutputSchema);
  const summaryValue: SummaryOutput = summary.ok
    ? summary.value
    : { summary: `${req.customer_name}: ${req.subject}`.slice(0, 400), key_points: [] };

  // 5. Deterministic retrieval of authorized records.
  const retrieval: RetrievalResult = await withTenant(ctx, (tx) =>
    getRetrievalService().retrieve(tx, business, { id: req.id, subject: req.subject, body: req.body, customer_id: req.customer_id }, cls),
  );

  // 6. Draft a response and 7. propose actions.
  const draft = await callTask(
    ai,
    "draft_response",
    runs,
    () =>
      ai.draftResponse({
        request: requestText,
        classification: cls,
        evidence: retrieval.evidence,
        retrievalNotes: retrieval.notes,
        businessName: business.name,
        signOff: business.settings.response_sign_off,
      }),
    draftOutputSchema,
  );
  const proposals = await callTask(
    ai,
    "propose_actions",
    runs,
    () =>
      ai.proposeActions({
        request: requestText,
        classification: cls,
        evidence: retrieval.evidence,
        retrievalNotes: retrieval.notes,
        allowedActions: AI_PROPOSABLE_ACTIONS.map((t) => ({
          type: t,
          description: ACTION_DESCRIPTIONS[t],
          params_schema: z.toJSONSchema(actionParamSchemas[t]),
        })),
        teamMembers: team,
      }),
    proposalOutputSchema,
  );

  // 8-10. Validate and persist everything in one transaction.
  return withTenant(ctx, async (tx) => {
    const runIds = await saveRuns(tx, ctx.businessId, req.id, ai, runs);
    const reviewReasons = new Set<string>();
    if (cls.injection_suspected) reviewReasons.add("possible_prompt_injection");
    if (cls.uncertainty.level === "high") reviewReasons.add("high_uncertainty");
    if (cls.missing_information.length) reviewReasons.add("missing_information");
    if (!req.customer_id) reviewReasons.add("customer_not_matched");
    if (!draft.ok || !proposals.ok || !summary.ok) reviewReasons.add(runs.some((r) => r.errorCode === "invalid_output") ? "ai_output_invalid" : "ai_unavailable");

    // Classification: a new current row; previous rows remain as history.
    await tx.exec("update request_classifications set is_current = false where request_id = $1 and is_current", [req.id]);
    const clsRow = await tx.one<{ id: string }>(
      `insert into request_classifications
         (business_id, request_id, source, category, summary, key_points, extracted_fields, missing_information,
          uncertainty_level, uncertainty_notes, suggested_next_step, injection_suspected, ai_run_id)
       values ($1, $2, 'ai', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [
        ctx.businessId,
        req.id,
        cls.category,
        summaryValue.summary,
        JSON.stringify(summaryValue.key_points),
        JSON.stringify({ ...cls.extracted, input_truncated: truncated }),
        JSON.stringify(cls.missing_information),
        cls.uncertainty.level,
        cls.uncertainty.notes,
        cls.suggested_next_step,
        cls.injection_suspected,
        runIds.classify ?? null,
      ],
    );

    await saveEvidence(tx, ctx.businessId, req.id, retrieval);
    await recordAudit(tx, ctx, {
      eventType: "retrieval.completed",
      result: "info",
      actorType: "system",
      requestId: req.id,
      entityType: "customer_request",
      entityId: req.id,
      metadata: {
        retrieval_run_id: retrieval.runId,
        records: retrieval.evidence.length,
        by_type: countBy(retrieval.evidence.map((e) => e.recordType)),
        notes: retrieval.notes.length,
      },
    });
    const supporting = retrieval.evidence.filter((e) => e.recordType !== "customer").length;
    if (supporting === 0) reviewReasons.add("no_supporting_records");

    // Earlier AI drafts are superseded by this run.
    await tx.exec(
      "update action_proposals set status = 'cancelled', cancel_reason = 'Superseded by a newer AI processing run' where request_id = $1 and origin = 'ai' and status = 'draft'",
      [req.id],
    );

    let created = 0;
    let blocked = 0;

    // Customer response: recipient is set by the server, never by the model.
    if (draft.ok) {
      const d: DraftOutput = draft.value;
      const grounding = checkGrounding(d.body, d.statements, retrieval.evidence);
      if (grounding.length) reviewReasons.add("unsupported_claims");
      if (d.needs_human_review) reviewReasons.add("missing_information");
      const recipient = req.customer_email;
      if (recipient) {
        try {
          await tx.savepoint(() => createProposal(tx, ctx, {
            requestId: req.id,
            actionType: "draft_customer_response",
            params: { to_email: recipient, subject: d.subject, body: d.body },
            explanation: d.needs_human_review && d.review_reason ? `Draft reply. Needs review: ${d.review_reason}` : "Draft reply based on the retrieved records.",
            evidenceRefs: d.statements.flatMap((s) => s.evidence_refs),
            unresolved: grounding.map((g) => g.detail),
            claims: [
              ...d.statements,
              ...d.unavailable_information.map((u) => ({ text: u, basis: "unavailable" as const, evidence_refs: [] })),
            ],
            origin: "ai",
            aiRunId: runIds.draft_response ?? null,
          }));
          created++;
        } catch (err) {
          blocked++;
          await auditRejectedOutput(tx, ctx, req.id, "draft_customer_response", err);
        }
      }
    }

    // Suggested actions: each validated independently; unsupported ones are refused and audited.
    if (proposals.ok) {
      for (const p of (proposals.value as ProposalOutput).proposals) {
        if (!isActionType(p.action_type) || !AI_PROPOSABLE_ACTIONS.includes(p.action_type)) {
          blocked++;
          reviewReasons.add("blocked_actions");
          await recordAudit(tx, ctx, {
            eventType: "proposal.blocked_by_policy",
            result: "denied",
            actorType: "ai",
            requestId: req.id,
            entityType: "customer_request",
            entityId: req.id,
            metadata: {
              attempted_action: p.action_type.slice(0, 64),
              reason: isActionType(p.action_type) ? "not_proposable_by_ai" : "unsupported_action_type",
            },
          });
          continue;
        }
        try {
          await tx.savepoint(() => createProposal(tx, ctx, {
            requestId: req.id,
            actionType: p.action_type,
            params: p.params,
            explanation: p.explanation,
            evidenceRefs: p.evidence_refs,
            unresolved: p.unresolved_requirements,
            origin: "ai",
            aiRunId: runIds.propose_actions ?? null,
          }));
          created++;
        } catch (err) {
          blocked++;
          reviewReasons.add("blocked_actions");
          await auditRejectedOutput(tx, ctx, req.id, p.action_type, err);
        }
      }
    }

    const reasons = [...reviewReasons];
    const aiFailed = !draft.ok || !proposals.ok;
    await tx.exec(
      `update customer_requests
          set category = $2, ai_status = $3, ai_error_code = $4,
              needs_human_review = $5, review_reasons = $6::text[]
        where id = $1`,
      [req.id, cls.category, "completed", aiFailed ? firstError(runs) : null, reasons.length > 0, reasons],
    );
    await setRequestStatus(tx, ctx, req.id, "processing", "needs_review", "ai_processing_completed");

    await runRequestClassifiedRules(tx, ctx, req.id, clsRow.id, {
      category: cls.category,
      channel: await tx.one<{ channel: string }>("select channel from customer_requests where id = $1", [req.id]).then((r) => r.channel),
      priority: null,
      has_customer_record: Boolean(req.customer_id),
      evidence_count: supporting,
      injection_suspected: cls.injection_suspected,
      uncertainty_level: cls.uncertainty.level,
    });

    await recordAudit(tx, ctx, {
      eventType: "ai.processing_completed",
      result: aiFailed ? "failure" : "success",
      actorType: "ai",
      requestId: req.id,
      entityType: "customer_request",
      entityId: req.id,
      metadata: {
        provider: ai.provider,
        model: ai.model,
        category: cls.category,
        proposals_created: created,
        proposals_blocked: blocked,
        review_reasons: reasons,
        injection_suspected: cls.injection_suspected,
        input_truncated: truncated,
        tasks_failed: runs.filter((r) => r.status === "failed").map((r) => r.task),
      },
    });

    return { status: "completed", category: cls.category, proposalsCreated: created, proposalsBlocked: blocked, reviewReasons: reasons };
  });
}

// ---------------------------------------------------------------------------

type RunRecord = {
  task: AITask;
  status: "succeeded" | "failed";
  errorCode: string | null;
  attempts: number;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

type TaskResult<T> = { ok: true; value: T } | { ok: false; code: string };

async function callTask<T>(ai: AIService, task: AITask, runs: RunRecord[], call: () => Promise<AIResult>, schema: z.ZodType<T>): Promise<TaskResult<T>> {
  const started = Date.now();
  try {
    const res = await call();
    const parsed = schema.safeParse(res.output);
    if (!parsed.success) {
      runs.push({ task, status: "failed", errorCode: "invalid_output", attempts: res.attempts, latencyMs: Date.now() - started, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens });
      return { ok: false, code: "invalid_output" };
    }
    runs.push({ task, status: "succeeded", errorCode: null, attempts: res.attempts, latencyMs: Date.now() - started, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens });
    return { ok: true, value: parsed.data };
  } catch (err) {
    const code = err instanceof AIError ? err.code : "unavailable";
    if (!(err instanceof AIError)) console.error(`[relayops] AI task ${task} threw`, (err as Error)?.message?.slice(0, 200));
    runs.push({ task, status: "failed", errorCode: code, attempts: err instanceof AIError ? err.attempts : 1, latencyMs: Date.now() - started, inputTokens: null, outputTokens: null });
    return { ok: false, code };
  }
}

async function saveRuns(tx: Tx, businessId: string, requestId: string, ai: AIService, runs: RunRecord[]) {
  const ids: Partial<Record<AITask, string>> = {};
  for (const r of runs) {
    const row = await tx.one<{ id: string }>(
      `insert into ai_runs (business_id, request_id, task, provider, model, prompt_version, status, error_code, attempts, latency_ms, input_tokens, output_tokens)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [businessId, requestId, r.task, ai.provider, ai.model, PROMPT_VERSION, r.status, r.errorCode, r.attempts, r.latencyMs, r.inputTokens, r.outputTokens],
    );
    if (r.status === "succeeded") ids[r.task] = row.id;
  }
  return ids;
}

function firstError(runs: RunRecord[]) {
  return runs.find((r) => r.status === "failed")?.errorCode ?? null;
}

async function finishFailed(ctx: ActorContext, req: LoadedRequest, runs: RunRecord[], code: string, ai: AIService): Promise<ProcessingOutcome> {
  return withTenant(ctx, async (tx) => {
    await saveRuns(tx, ctx.businessId, req.id, ai, runs);
    const reason = code === "invalid_output" ? "ai_output_invalid" : "ai_unavailable";
    await tx.exec(
      `update customer_requests set ai_status = 'failed', ai_error_code = $2, needs_human_review = true,
              review_reasons = (select array_agg(distinct r) from unnest(review_reasons || array[$3]) r)
        where id = $1`,
      [req.id, code, reason],
    );
    await setRequestStatus(tx, ctx, req.id, "processing", "needs_review", "ai_processing_failed");
    await recordAudit(tx, ctx, {
      eventType: "ai.processing_failed",
      result: "failure",
      actorType: "ai",
      requestId: req.id,
      entityType: "customer_request",
      entityId: req.id,
      metadata: { provider: ai.provider, model: ai.model, error_code: code, fallback: "manual_workflow" },
    });
    return { status: "failed", category: null, proposalsCreated: 0, proposalsBlocked: 0, reviewReasons: [reason], errorCode: code };
  });
}

async function auditRejectedOutput(tx: Tx, ctx: ActorContext, requestId: string, actionType: string, err: unknown) {
  const reason = err instanceof AppError ? err.message : "Validation failed";
  await recordAudit(tx, ctx, {
    eventType: "ai.output_rejected",
    result: "denied",
    actorType: "ai",
    requestId,
    entityType: "customer_request",
    entityId: requestId,
    metadata: { attempted_action: actionType.slice(0, 64), reason },
  });
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, v) => ((acc[v] = (acc[v] ?? 0) + 1), acc), {});
}

export type { BusinessRecord };
