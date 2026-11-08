import "server-only";
import { z } from "zod";
import { withTenant } from "@/server/db/tenant";
import type { UserContext } from "@/server/auth/types";
import { assertCan } from "@/server/auth/permissions";
import { recordAudit } from "@/server/audit/audit";
import { AppError, invalid, notFound } from "@/server/errors";
import { ruleInputSchema, type RuleAction, type RuleCondition, type RuleTrigger } from "@/server/rules/schemas";

export type RuleRow = {
  id: string;
  name: string;
  description: string;
  is_enabled: boolean;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  action: RuleAction;
  requires_approval: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  updated_by_name: string | null;
  times_applied: number;
};

export async function listRules(ctx: UserContext) {
  return withTenant(ctx, async (tx) => {
    const rules = await tx.many<RuleRow>(
      `select w.id, w.name, w.description, w.is_enabled, w.trigger, w.conditions, w.action, w.requires_approval, w.sort_order,
              w.created_at, w.updated_at, p.full_name as updated_by_name,
              (select count(*)::int from workflow_executions e where e.rule_id = w.id and e.status = 'succeeded') as times_applied
         from workflow_rules w left join profiles p on p.id = w.updated_by
        order by w.trigger, w.sort_order, w.created_at`,
    );
    const team = await tx.many<{ user_id: string; full_name: string }>(
      `select m.user_id, p.full_name from business_memberships m join profiles p on p.id = m.user_id where m.status = 'active' order by p.full_name`,
    );
    const categories = await tx.many<{ key: string; label: string }>("select key, label from request_categories order by sort_order, label");
    return { rules, team, categories };
  });
}

function parseRule(input: unknown) {
  const parsed = ruleInputSchema.safeParse(input);
  if (!parsed.success) {
    const details: Record<string, string> = {};
    for (const i of parsed.error.issues) details[i.path.join(".") || "form"] ??= i.message;
    throw new AppError("validation", Object.values(details)[0] ?? "The rule is invalid.", details);
  }
  return parsed.data;
}

async function checkReferences(tx: Parameters<Parameters<typeof withTenant>[1]>[0], rule: ReturnType<typeof parseRule>) {
  if (rule.action.type === "assign_to") {
    const member = await tx.maybeOne("select 1 from business_memberships where user_id = $1 and status = 'active'", [rule.action.user_id]);
    if (!member) throw invalid("The selected team member is not active in this business.");
  }
  for (const c of rule.conditions) {
    if (c.field === "category") {
      const values = Array.isArray(c.value) ? c.value : [c.value];
      const known = await tx.many<{ key: string }>("select key from request_categories where key = any($1::text[])", [values]);
      if (known.length !== values.length) throw invalid("A condition refers to an unknown category.");
    }
  }
}

export async function createRule(ctx: UserContext, input: unknown) {
  assertCan(ctx, "rules.manage");
  const rule = parseRule(input);
  return withTenant(ctx, async (tx) => {
    await checkReferences(tx, rule);
    const row = await tx.one<{ id: string }>(
      `insert into workflow_rules (business_id, name, description, is_enabled, trigger, conditions, action, requires_approval, sort_order, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) returning id`,
      [ctx.businessId, rule.name, rule.description, rule.is_enabled, rule.trigger, JSON.stringify(rule.conditions), JSON.stringify(rule.action), rule.requires_approval, rule.sort_order, ctx.userId],
    );
    await recordAudit(tx, ctx, {
      eventType: "rule.created",
      result: "success",
      entityType: "workflow_rule",
      entityId: row.id,
      metadata: { name: rule.name, trigger: rule.trigger, effect: rule.action.type, conditions: rule.conditions.length, enabled: rule.is_enabled },
    });
    return row.id;
  });
}

export async function updateRule(ctx: UserContext, ruleId: string, input: unknown) {
  assertCan(ctx, "rules.manage");
  if (!z.uuid().safeParse(ruleId).success) throw notFound("Rule not found.");
  const rule = parseRule(input);
  return withTenant(ctx, async (tx) => {
    await checkReferences(tx, rule);
    const before = await tx.maybeOne<{ is_enabled: boolean; name: string }>("select is_enabled, name from workflow_rules where id = $1 for update", [ruleId]);
    if (!before) throw notFound("Rule not found.");
    await tx.exec(
      `update workflow_rules set name = $2, description = $3, is_enabled = $4, trigger = $5, conditions = $6, action = $7,
              requires_approval = $8, sort_order = $9, updated_by = $10 where id = $1`,
      [ruleId, rule.name, rule.description, rule.is_enabled, rule.trigger, JSON.stringify(rule.conditions), JSON.stringify(rule.action), rule.requires_approval, rule.sort_order, ctx.userId],
    );
    await recordAudit(tx, ctx, {
      eventType: "rule.updated",
      result: "success",
      entityType: "workflow_rule",
      entityId: ruleId,
      metadata: { name: rule.name, trigger: rule.trigger, effect: rule.action.type, enabled: rule.is_enabled, was_enabled: before.is_enabled },
    });
  });
}

export async function setRuleEnabled(ctx: UserContext, ruleId: string, enabled: boolean) {
  assertCan(ctx, "rules.manage");
  if (!z.uuid().safeParse(ruleId).success) throw notFound("Rule not found.");
  return withTenant(ctx, async (tx) => {
    const row = await tx.maybeOne<{ name: string }>("update workflow_rules set is_enabled = $2, updated_by = $3 where id = $1 returning name", [ruleId, enabled, ctx.userId]);
    if (!row) throw notFound("Rule not found.");
    await recordAudit(tx, ctx, { eventType: "rule.updated", result: "success", entityType: "workflow_rule", entityId: ruleId, metadata: { name: row.name, enabled } });
  });
}

export async function deleteRule(ctx: UserContext, ruleId: string) {
  assertCan(ctx, "rules.manage");
  if (!z.uuid().safeParse(ruleId).success) throw notFound("Rule not found.");
  return withTenant(ctx, async (tx) => {
    const row = await tx.maybeOne<{ name: string; trigger: string }>("delete from workflow_rules where id = $1 returning name, trigger", [ruleId]);
    if (!row) throw notFound("Rule not found.");
    await recordAudit(tx, ctx, { eventType: "rule.deleted", result: "success", entityType: "workflow_rule", entityId: ruleId, metadata: { name: row.name, trigger: row.trigger } });
  });
}
