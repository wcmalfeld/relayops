import "server-only";
import { z } from "zod";
import { withTenant } from "@/server/db/tenant";
import type { Tx } from "@/server/db/pool";
import { loadBusiness } from "@/server/settings/business";
import type { UserContext } from "@/server/auth/types";
import { notFound } from "@/server/errors";
import { REQUEST_STATUSES, type ActionType, type Priority, type ProposalStatus, type RequestChannel, type RequestStatus, type RiskLevel } from "@/lib/domain";

export const inboxFilterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(REQUEST_STATUSES).optional().catch(undefined),
  category: z.string().trim().regex(/^[a-z0-9_]{2,48}$/).optional().catch(undefined),
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.uuid()]).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  review: z.literal("1").optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
export type InboxFilters = z.infer<typeof inboxFilterSchema>;

export const PAGE_SIZE = 15;

export type InboxRow = {
  id: string;
  reference: string;
  customer_name: string;
  subject: string;
  summary: string | null;
  category: string | null;
  category_label: string | null;
  priority: Priority | null;
  status: RequestStatus;
  channel: RequestChannel;
  created_at: Date;
  received_at: Date;
  assigned_to: string | null;
  assignee_name: string | null;
  needs_human_review: boolean;
  flagged_unresolved_at: Date | null;
  pending_approvals: number;
  draft_proposals: number;
  ai_status: string;
};

export async function listRequests(ctx: UserContext, filters: InboxFilters) {
  return withTenant(ctx, async (tx) => {
    const where: string[] = ["true"];
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (filters.q) {
      const like = p(`%${filters.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
      where.push(`(r.customer_name ilike ${like} or r.subject ilike ${like} or r.reference ilike ${like} or r.body ilike ${like})`);
    }
    if (filters.status) where.push(`r.status = ${p(filters.status)}`);
    if (filters.category) where.push(`r.category = ${p(filters.category)}`);
    if (filters.assignee === "me") where.push(`r.assigned_to = ${p(ctx.userId)}`);
    else if (filters.assignee === "unassigned") where.push("r.assigned_to is null");
    else if (filters.assignee) where.push(`r.assigned_to = ${p(filters.assignee)}`);
    if (filters.from) where.push(`r.received_at >= ${p(filters.from)}::date`);
    if (filters.to) where.push(`r.received_at < ${p(filters.to)}::date + 1`);
    if (filters.review) where.push("r.needs_human_review and r.status not in ('completed', 'rejected')");

    const whereSql = where.join(" and ");
    const total = await tx.one<{ n: number }>(`select count(*)::int as n from customer_requests r where ${whereSql}`, params);
    const offset = (filters.page - 1) * PAGE_SIZE;
    const rows = await tx.many<InboxRow>(
      `select r.id, r.reference, r.customer_name, r.subject, cl.summary, r.category, rc.label as category_label,
              r.priority, r.status, r.channel, r.created_at, r.received_at, r.assigned_to, ap.full_name as assignee_name,
              r.needs_human_review, r.flagged_unresolved_at, r.ai_status,
              (select count(*)::int from action_proposals x where x.request_id = r.id and x.status = 'pending_approval') as pending_approvals,
              (select count(*)::int from action_proposals x where x.request_id = r.id and x.status = 'draft') as draft_proposals
         from customer_requests r
         left join request_classifications cl on cl.request_id = r.id and cl.is_current
         left join request_categories rc on rc.key = r.category
         left join profiles ap on ap.id = r.assigned_to
        where ${whereSql}
        order by r.received_at desc, r.id
        limit ${PAGE_SIZE} offset ${offset}`,
      params,
    );
    return { rows, total: total.n, page: filters.page, pageCount: Math.max(1, Math.ceil(total.n / PAGE_SIZE)) };
  });
}

/** Deterministic description of what a request needs next. */
export function nextAction(r: Pick<InboxRow, "status" | "pending_approvals" | "draft_proposals" | "ai_status" | "needs_human_review">) {
  switch (r.status) {
    case "new":
      return "Process with AI or handle manually";
    case "processing":
      return "AI processing in progress";
    case "needs_review":
      if (r.ai_status === "failed") return "AI unavailable — handle manually";
      return r.draft_proposals > 0 ? "Review drafted response and actions" : "Review and decide next step";
    case "awaiting_approval":
      return `Owner approval needed (${r.pending_approvals})`;
    case "approved":
      return "Execute approved action";
    case "failed":
      return "Execution failed — retry or revise";
    case "completed":
    case "rejected":
      return "No action needed";
  }
}

/**
 * Resolve identifiers inside proposal parameters to readable labels, so an
 * approver sees "Sat, Oct 24 10:00 AM" next to the slot id, not just a UUID.
 */
export async function resolveParamLabels(tx: Tx, proposals: { params: Record<string, unknown> }[], timezone: string) {
  const ids = (key: string) => [...new Set(proposals.map((p) => p.params[key]).filter((v): v is string => typeof v === "string"))];
  const labels: Record<string, string> = {};
  const slotIds = ids("appointment_slot_id");
  if (slotIds.length) {
    for (const r of await tx.many<{ id: string; starts_at: Date; status: string; technician_name: string | null }>(
      "select id, starts_at, status, technician_name from appointments where id = any($1::uuid[])",
      [slotIds],
    )) {
      const when = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(r.starts_at));
      labels[r.id] = `${when}${r.technician_name ? ` with ${r.technician_name}` : ""} (slot ${r.status})`;
    }
  }
  const customerIds = ids("customer_id");
  if (customerIds.length) {
    for (const r of await tx.many<{ id: string; full_name: string }>("select id, full_name from customers where id = any($1::uuid[])", [customerIds])) {
      labels[r.id] = r.full_name;
    }
  }
  const orderIds = ids("order_id");
  if (orderIds.length) {
    for (const r of await tx.many<{ id: string; order_number: string; total_cents: number }>("select id, order_number, total_cents from orders where id = any($1::uuid[])", [orderIds])) {
      labels[r.id] = `${r.order_number} (total $${(r.total_cents / 100).toFixed(2)})`;
    }
  }
  const userIds = ids("assignee_user_id");
  if (userIds.length) {
    for (const r of await tx.many<{ id: string; full_name: string }>("select id, full_name from profiles where id = any($1::uuid[])", [userIds])) {
      labels[r.id] = r.full_name;
    }
  }
  return labels;
}

export type ProposalView = {
  id: string;
  action_type: ActionType;
  params: Record<string, unknown>;
  params_hash: string;
  original_params: Record<string, unknown>;
  version: number;
  explanation: string;
  evidence_refs: string[];
  unresolved_requirements: string[];
  claims: { text: string; basis: "record" | "customer" | "assumption" | "unavailable"; evidence_refs: string[] }[];
  risk_level: RiskLevel;
  requires_approval: boolean;
  status: ProposalStatus;
  origin: "ai" | "user" | "rule";
  created_at: Date;
  updated_at: Date;
  created_by_name: string | null;
  submitted_by_name: string | null;
  executed_by_name: string | null;
  executed_at: Date | null;
  execution_result: Record<string, unknown> | null;
  failure_reason: string | null;
  cancel_reason: string | null;
  approvals: {
    id: string;
    decision: "approved" | "rejected";
    decided_by_name: string;
    proposal_version: number;
    params_hash: string;
    comment: string | null;
    created_at: Date;
    invalidated_at: Date | null;
    invalidation_reason: string | null;
  }[];
  revision_count: number;
};

export async function getRequestDetail(ctx: UserContext, requestId: string) {
  if (!z.uuid().safeParse(requestId).success) throw notFound("Request not found.");
  return withTenant(ctx, async (tx) => {
    const request = await tx.maybeOne<{
      id: string;
      reference: string;
      customer_id: string | null;
      customer_name: string;
      customer_email: string | null;
      customer_phone: string | null;
      channel: RequestChannel;
      subject: string;
      body: string;
      status: RequestStatus;
      category: string | null;
      priority: Priority | null;
      assigned_to: string | null;
      assignee_name: string | null;
      ai_status: string;
      ai_error_code: string | null;
      needs_human_review: boolean;
      review_reasons: string[];
      flagged_unresolved_at: Date | null;
      external_ref: string | null;
      is_demo: boolean;
      received_at: Date;
      created_at: Date;
      resolved_at: Date | null;
      created_by_name: string | null;
    }>(
      `select r.*, ap.full_name as assignee_name, cb.full_name as created_by_name
         from customer_requests r
         left join profiles ap on ap.id = r.assigned_to
         left join profiles cb on cb.id = r.created_by
        where r.id = $1`,
      [requestId],
    );
    if (!request) throw notFound("Request not found.");

    const customer = request.customer_id
      ? await tx.maybeOne<{ id: string; full_name: string; email: string | null; phone: string | null; created_at: Date }>(
          "select id, full_name, email, phone, created_at from customers where id = $1",
          [request.customer_id],
        )
      : null;

    const classifications = await tx.many<{
      id: string;
      source: "ai" | "human";
      category: string;
      summary: string;
      key_points: string[];
      extracted_fields: Record<string, unknown>;
      missing_information: string[];
      uncertainty_level: "low" | "medium" | "high" | null;
      uncertainty_notes: string | null;
      suggested_next_step: string | null;
      injection_suspected: boolean;
      is_current: boolean;
      correction_reason: string | null;
      created_at: Date;
      created_by_name: string | null;
      provider: string | null;
      model: string | null;
      prompt_version: string | null;
    }>(
      `select c.id, c.source, c.category, c.summary, c.key_points, c.extracted_fields, c.missing_information,
              c.uncertainty_level, c.uncertainty_notes, c.suggested_next_step, c.injection_suspected, c.is_current,
              c.correction_reason, c.created_at, p.full_name as created_by_name, ar.provider, ar.model, ar.prompt_version
         from request_classifications c
         left join profiles p on p.id = c.created_by
         left join ai_runs ar on ar.id = c.ai_run_id
        where c.request_id = $1 order by c.created_at desc`,
      [requestId],
    );

    const latestRun = await tx.maybeOne<{ retrieval_run_id: string }>(
      "select retrieval_run_id from retrieved_records where request_id = $1 order by created_at desc limit 1",
      [requestId],
    );
    const evidence = latestRun
      ? await tx.many<{ id: string; ref: string; record_type: string; label: string; facts: Record<string, unknown>; match_reason: string }>(
          "select id, ref, record_type, label, facts, match_reason from retrieved_records where retrieval_run_id = $1 order by record_type, label",
          [latestRun.retrieval_run_id],
        )
      : [];

    const proposals = await tx.many<ProposalView>(
      `select p.id, p.action_type, p.params, p.params_hash, p.original_params, p.version, p.explanation, p.evidence_refs,
              p.unresolved_requirements, p.claims, p.risk_level, p.requires_approval, p.status, p.origin, p.created_at, p.updated_at,
              cb.full_name as created_by_name, sb.full_name as submitted_by_name, eb.full_name as executed_by_name,
              p.executed_at, p.execution_result, p.failure_reason, p.cancel_reason,
              coalesce((select json_agg(json_build_object(
                  'id', a.id, 'decision', a.decision, 'decided_by_name', dp.full_name, 'proposal_version', a.proposal_version,
                  'params_hash', a.params_hash, 'comment', a.comment, 'created_at', a.created_at,
                  'invalidated_at', a.invalidated_at, 'invalidation_reason', a.invalidation_reason) order by a.created_at desc)
                 from action_approvals a join profiles dp on dp.id = a.decided_by where a.proposal_id = p.id), '[]'::json) as approvals,
              (select count(*)::int from action_proposal_revisions rv where rv.proposal_id = p.id) as revision_count
         from action_proposals p
         left join profiles cb on cb.id = p.created_by
         left join profiles sb on sb.id = p.submitted_by
         left join profiles eb on eb.id = p.executed_by
        where p.request_id = $1
        order by (p.status in ('draft', 'pending_approval', 'approved', 'failed')) desc, p.created_at desc`,
      [requestId],
    );

    const notes = await tx.many<{ id: string; body: string; author_name: string | null; created_at: Date }>(
      `select n.id, n.body, p.full_name as author_name, n.created_at from internal_notes n
         left join profiles p on p.id = n.author_user_id where n.request_id = $1 order by n.created_at desc`,
      [requestId],
    );
    const deliveries = await tx.many<{ id: string; to_address: string; subject: string; body: string; provider: string; simulated: boolean; status: string; provider_message_id: string | null; created_at: Date }>(
      "select id, to_address, subject, body, provider, simulated, status, provider_message_id, created_at from message_deliveries where request_id = $1 order by created_at desc",
      [requestId],
    );
    const timeline = await tx.many<{
      id: string;
      event_type: string;
      actor_type: string;
      actor_name: string | null;
      result: string;
      metadata: Record<string, unknown>;
      entity_type: string | null;
      entity_id: string | null;
      created_at: Date;
    }>(
      `select e.id, e.event_type, e.actor_type, p.full_name as actor_name, e.result, e.metadata, e.entity_type, e.entity_id, e.created_at
         from audit_events e left join profiles p on p.id = e.actor_user_id
        where e.request_id = $1 order by e.created_at desc, e.id limit 200`,
      [requestId],
    );
    const aiRuns = await tx.many<{ task: string; provider: string; model: string; status: string; error_code: string | null; latency_ms: number | null; input_tokens: number | null; output_tokens: number | null; attempts: number; created_at: Date }>(
      "select task, provider, model, status, error_code, latency_ms, input_tokens, output_tokens, attempts, created_at from ai_runs where request_id = $1 order by created_at desc limit 12",
      [requestId],
    );
    const categories = await tx.many<{ key: string; label: string }>("select key, label from request_categories where is_enabled order by sort_order, label");
    const team = await tx.many<{ user_id: string; full_name: string; role: string; title: string | null }>(
      `select m.user_id, p.full_name, m.role, m.title from business_memberships m join profiles p on p.id = m.user_id
        where m.status = 'active' and p.is_active order by p.full_name`,
    );
    const slots = await tx.many<{ id: string; starts_at: Date; service_type: string; technician_name: string | null }>(
      "select id, starts_at, service_type, technician_name from appointments where status = 'available' and starts_at > now() order by starts_at limit 20",
    );
    const orders = request.customer_id
      ? await tx.many<{ id: string; order_number: string; total_cents: number; status: string }>(
          "select id, order_number, total_cents, status from orders where customer_id = $1 order by placed_at desc limit 10",
          [request.customer_id],
        )
      : [];

    const business = await loadBusiness(tx);
    const paramLabels = await resolveParamLabels(tx, proposals, business.timezone);
    return { request, customer, classifications, evidence, proposals, paramLabels, notes, deliveries, timeline, aiRuns, categories, team, slots, orders, business };
  });
}

export type RequestDetail = Awaited<ReturnType<typeof getRequestDetail>>;

export type QueueItem = ProposalView & {
  request_id: string;
  reference: string;
  customer_name: string;
  subject: string;
  evidence: { ref: string; label: string }[];
};

export async function listApprovalQueue(ctx: UserContext) {
  return withTenant(ctx, async (tx) => {
    const items = await tx.many<QueueItem>(
      `select p.id, p.request_id, r.reference, r.customer_name, r.subject, p.action_type, p.params, p.params_hash,
              p.original_params, p.version, p.explanation, p.evidence_refs, p.unresolved_requirements, p.claims, p.risk_level,
              p.requires_approval, p.status, p.origin, p.created_at, p.updated_at, cb.full_name as created_by_name,
              sb.full_name as submitted_by_name, null as executed_by_name, p.executed_at, p.execution_result,
              p.failure_reason, p.cancel_reason, '[]'::json as approvals,
              (select count(*)::int from action_proposal_revisions rv where rv.proposal_id = p.id) as revision_count,
              coalesce((select json_agg(json_build_object('ref', e.ref, 'label', e.label))
                          from (select distinct on (rr.ref) rr.ref, rr.label from retrieved_records rr
                                 where rr.request_id = p.request_id
                                   and rr.ref in (select jsonb_array_elements_text(p.evidence_refs))) e), '[]'::json) as evidence
         from action_proposals p
         join customer_requests r on r.id = p.request_id
         left join profiles cb on cb.id = p.created_by
         left join profiles sb on sb.id = p.submitted_by
        where p.status in ('pending_approval', 'approved', 'failed')
        order by (p.status = 'pending_approval') desc, p.submitted_at asc nulls last, p.updated_at desc`,
    );
    const business = await loadBusiness(tx);
    const paramLabels = await resolveParamLabels(tx, items, business.timezone);
    return { items, paramLabels, timezone: business.timezone };
  });
}
