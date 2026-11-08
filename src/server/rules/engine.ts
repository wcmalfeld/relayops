import "server-only";
import type { Tx } from "@/server/db/pool";
import type { ActorContext } from "@/server/auth/types";
import { recordAudit } from "@/server/audit/audit";
import { withTenant } from "@/server/db/tenant";
import { withConnection } from "@/server/db/pool";
import {
  conditionsMatch,
  ruleInputSchema,
  type RuleAction,
  type RuleFacts,
  type RuleTrigger,
  type ValidRule,
} from "@/server/rules/schemas";
import type { ActionType } from "@/lib/domain";

type StoredRule = ValidRule & { id: string };

async function loadRules(tx: Tx, trigger: RuleTrigger): Promise<StoredRule[]> {
  const rows = await tx.many<{
    id: string;
    name: string;
    description: string;
    is_enabled: boolean;
    trigger: RuleTrigger;
    conditions: unknown;
    action: unknown;
    requires_approval: boolean;
    sort_order: number;
  }>(
    `select id, name, description, is_enabled, trigger, conditions, action, requires_approval, sort_order
       from workflow_rules where trigger = $1 and is_enabled order by sort_order, created_at`,
    [trigger],
  );
  const rules: StoredRule[] = [];
  for (const row of rows) {
    // Stored rules are re-validated on every read; a rule that no longer
    // passes validation is ignored rather than partially applied.
    const parsed = ruleInputSchema.safeParse({
      name: row.name,
      description: row.description,
      is_enabled: row.is_enabled,
      trigger: row.trigger,
      conditions: row.conditions,
      action: row.action,
      requires_approval: row.requires_approval,
      sort_order: row.sort_order,
    });
    if (parsed.success) rules.push({ ...parsed.data, id: row.id });
  }
  return rules;
}

async function claimRuleExecution(tx: Tx, ctx: ActorContext, rule: StoredRule, requestId: string, runKey: string, detail: Record<string, unknown>) {
  const res = await tx.maybeOne<{ id: string }>(
    `insert into workflow_executions (business_id, kind, rule_id, request_id, status, idempotency_key, detail, actor_user_id, finished_at)
     values ($1, 'rule', $2, $3, 'succeeded', $4, $5, $6, now())
     on conflict (business_id, idempotency_key) where kind = 'rule' do nothing
     returning id`,
    [ctx.businessId, rule.id, requestId, `${rule.id}:${runKey}`, JSON.stringify(detail), ctx.kind === "user" ? ctx.userId : null],
  );
  return Boolean(res);
}

async function applyEffect(tx: Tx, ctx: ActorContext, rule: StoredRule, requestId: string, action: RuleAction, runKey: string) {
  switch (action.type) {
    case "assign_to": {
      const req = await tx.maybeOne<{ assigned_to: string | null }>("select assigned_to from customer_requests where id = $1 for update", [requestId]);
      if (!req || req.assigned_to) return false; // never override a human assignment
      const member = await tx.maybeOne<{ user_id: string }>(
        "select user_id from business_memberships where user_id = $1 and status = 'active'",
        [action.user_id],
      );
      if (!member) return false;
      if (!(await claimRuleExecution(tx, ctx, rule, requestId, runKey, { effect: action.type }))) return false;

      if (rule.requires_approval) {
        const { createProposal } = await import("@/server/actions/proposals");
        await createProposal(tx, ctx, {
          requestId,
          actionType: "assign_team_member",
          params: { assignee_user_id: action.user_id },
          explanation: `Workflow rule "${rule.name}" routes this request to this team member. The rule requires approval before assignment.`,
          evidenceRefs: [],
          unresolved: [],
          origin: "rule",
          forceApproval: true,
        });
      } else {
        await tx.exec("update customer_requests set assigned_to = $2 where id = $1", [requestId, action.user_id]);
        await recordAudit(tx, ctx, {
          eventType: "request.assigned",
          result: "success",
          actorType: "system",
          requestId,
          entityType: "customer_request",
          entityId: requestId,
          metadata: { assignee_user_id: action.user_id, via_rule: rule.id, rule_name: rule.name },
        });
      }
      return true;
    }
    case "set_priority": {
      if (!(await claimRuleExecution(tx, ctx, rule, requestId, runKey, { effect: action.type, priority: action.priority }))) return false;
      await tx.exec("update customer_requests set priority = $2, priority_rule_id = $3 where id = $1", [requestId, action.priority, rule.id]);
      await recordAudit(tx, ctx, {
        eventType: "request.priority_set",
        result: "success",
        actorType: "system",
        requestId,
        entityType: "customer_request",
        entityId: requestId,
        metadata: { priority: action.priority, via_rule: rule.id, rule_name: rule.name },
      });
      return true;
    }
    case "require_human_review": {
      if (!(await claimRuleExecution(tx, ctx, rule, requestId, runKey, { effect: action.type }))) return false;
      await tx.exec(
        `update customer_requests
            set needs_human_review = true,
                review_reasons = (select array_agg(distinct r) from unnest(review_reasons || array['rule']) r)
          where id = $1`,
        [requestId],
      );
      await recordAudit(tx, ctx, {
        eventType: "request.review_required",
        result: "info",
        actorType: "system",
        requestId,
        entityType: "customer_request",
        entityId: requestId,
        metadata: { via_rule: rule.id, rule_name: rule.name, reason: action.reason },
      });
      return true;
    }
    default:
      return false;
  }
}

async function auditRuleApplied(tx: Tx, ctx: ActorContext, rule: StoredRule, requestId: string, trigger: RuleTrigger) {
  await recordAudit(tx, ctx, {
    eventType: "rule.applied",
    result: "success",
    actorType: "system",
    requestId,
    entityType: "workflow_rule",
    entityId: rule.id,
    metadata: { rule_name: rule.name, trigger, effect: rule.action.type },
  });
}

export async function runRequestCreatedRules(tx: Tx, ctx: ActorContext, requestId: string) {
  const req = await tx.one<{ channel: string; customer_id: string | null }>(
    "select channel, customer_id from customer_requests where id = $1",
    [requestId],
  );
  const facts: RuleFacts = { channel: req.channel, has_customer_record: Boolean(req.customer_id) };
  let processWithAi = false;
  for (const rule of await loadRules(tx, "request.created")) {
    if (!conditionsMatch(rule.conditions, facts)) continue;
    if (rule.action.type === "process_with_ai") {
      if (await claimRuleExecution(tx, ctx, rule, requestId, `created:${requestId}`, { effect: "process_with_ai" })) {
        processWithAi = true;
        await auditRuleApplied(tx, ctx, rule, requestId, "request.created");
      }
      continue;
    }
    if (await applyEffect(tx, ctx, rule, requestId, rule.action, `created:${requestId}`)) {
      await auditRuleApplied(tx, ctx, rule, requestId, "request.created");
    }
  }
  return { processWithAi };
}

export async function runRequestClassifiedRules(tx: Tx, ctx: ActorContext, requestId: string, runKey: string, facts: RuleFacts) {
  let applied = 0;
  for (const rule of await loadRules(tx, "request.classified")) {
    if (!conditionsMatch(rule.conditions, facts)) continue;
    if (await applyEffect(tx, ctx, rule, requestId, rule.action, `classified:${runKey}`)) {
      applied++;
      await auditRuleApplied(tx, ctx, rule, requestId, "request.classified");
    }
  }
  return applied;
}

/** Rules can add an approval requirement to an action; they cannot remove one. */
export async function approvalRequiredByRules(tx: Tx, actionType: ActionType, category: string | null) {
  const matching: string[] = [];
  for (const rule of await loadRules(tx, "proposal.created")) {
    if (rule.action.type !== "require_approval") continue;
    if (!rule.action.action_types.includes(actionType)) continue;
    if (!conditionsMatch(rule.conditions, { action_type: actionType, category })) continue;
    matching.push(rule.name);
  }
  return matching;
}

/**
 * Flag open requests that have gone unresolved longer than a rule allows.
 * Runs on demand (dashboard button) or from the scheduled cron route.
 */
export async function runUnresolvedCheck(ctx: ActorContext) {
  return withTenant(ctx, async (tx) => {
    let flagged = 0;
    for (const rule of await loadRules(tx, "request.unresolved_check")) {
      if (rule.action.type !== "flag_unresolved") continue;
      const candidates = await tx.many<{ id: string; category: string | null; priority: string | null; channel: string }>(
        `select id, category, priority, channel from customer_requests
          where status not in ('completed', 'rejected') and flagged_unresolved_at is null
            and received_at < now() - make_interval(hours => $1)
          order by received_at limit 200`,
        [rule.action.after_hours],
      );
      for (const c of candidates) {
        if (!conditionsMatch(rule.conditions, { category: c.category, priority: c.priority, channel: c.channel })) continue;
        if (!(await claimRuleExecution(tx, ctx, rule, c.id, `unresolved:${c.id}`, { effect: "flag_unresolved", after_hours: rule.action.after_hours }))) continue;
        await tx.exec("update customer_requests set flagged_unresolved_at = now() where id = $1", [c.id]);
        await recordAudit(tx, ctx, {
          eventType: "request.flagged_unresolved",
          result: "info",
          actorType: "system",
          requestId: c.id,
          entityType: "customer_request",
          entityId: c.id,
          metadata: { via_rule: rule.id, rule_name: rule.name, after_hours: rule.action.after_hours },
        });
        flagged++;
      }
    }
    return flagged;
  });
}

/** Run the unresolved check for every business, each under its own system context. */
export async function runUnresolvedCheckForAllBusinesses() {
  const ids = await withConnection((tx) => tx.many<{ id: string }>("select app.list_business_ids_for_scheduler() as id"));
  let flagged = 0;
  for (const { id } of ids) {
    flagged += await runUnresolvedCheck({ kind: "system", businessId: id, source: "scheduler" });
  }
  return { businesses: ids.length, flagged };
}
