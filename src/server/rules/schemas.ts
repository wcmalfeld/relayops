import { z } from "zod";
import { ACTION_TYPES, PRIORITIES, REQUEST_CHANNELS } from "@/lib/domain";

/**
 * Workflow rules are deterministic: a trigger, up to five conditions combined
 * with AND, and exactly one effect from a fixed list. Rules can make the
 * workflow stricter (require review, require approval) but can never bypass
 * an approval that the action policy requires.
 */

export const RULE_TRIGGERS = ["request.created", "request.classified", "request.unresolved_check", "proposal.created"] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];

export const TRIGGER_LABELS: Record<RuleTrigger, string> = {
  "request.created": "When a request is created",
  "request.classified": "After AI classification",
  "request.unresolved_check": "Unresolved request check",
  "proposal.created": "When a proposal is created",
};

export const CONDITION_FIELDS = {
  category: { type: "string", label: "Category" },
  channel: { type: "string", label: "Channel" },
  priority: { type: "string", label: "Priority" },
  has_customer_record: { type: "boolean", label: "Sender matches a customer" },
  evidence_count: { type: "number", label: "Supporting records found" },
  injection_suspected: { type: "boolean", label: "Possible prompt injection" },
  uncertainty_level: { type: "string", label: "AI uncertainty" },
  action_type: { type: "string", label: "Proposed action type" },
} as const;
export type ConditionField = keyof typeof CONDITION_FIELDS;

const FIELDS_BY_TRIGGER: Record<RuleTrigger, ConditionField[]> = {
  "request.created": ["channel", "has_customer_record"],
  "request.classified": ["category", "channel", "priority", "has_customer_record", "evidence_count", "injection_suspected", "uncertainty_level"],
  "request.unresolved_check": ["category", "priority", "channel"],
  "proposal.created": ["action_type", "category"],
};

export const OPERATORS = ["eq", "neq", "in", "gte", "lte"] as const;
export const OPERATOR_LABELS: Record<(typeof OPERATORS)[number], string> = {
  eq: "is",
  neq: "is not",
  in: "is one of",
  gte: "is at least",
  lte: "is at most",
};

export const conditionSchema = z.strictObject({
  field: z.enum(Object.keys(CONDITION_FIELDS) as [ConditionField, ...ConditionField[]]),
  op: z.enum(OPERATORS),
  value: z.union([z.string().trim().min(1).max(60), z.number().min(0).max(10_000), z.boolean(), z.array(z.string().trim().min(1).max(60)).min(1).max(12)]),
});
export type RuleCondition = z.infer<typeof conditionSchema>;

export const ruleActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("process_with_ai") }),
  z.strictObject({ type: z.literal("assign_to"), user_id: z.uuid() }),
  z.strictObject({ type: z.literal("set_priority"), priority: z.enum(PRIORITIES) }),
  z.strictObject({ type: z.literal("require_human_review"), reason: z.string().trim().min(1).max(200) }),
  z.strictObject({ type: z.literal("flag_unresolved"), after_hours: z.number().int().min(1).max(24 * 30) }),
  z.strictObject({ type: z.literal("require_approval"), action_types: z.array(z.enum(ACTION_TYPES)).min(1).max(ACTION_TYPES.length) }),
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;
export type RuleActionType = RuleAction["type"];

export const RULE_ACTION_LABELS: Record<RuleActionType, string> = {
  process_with_ai: "Classify and draft with AI",
  assign_to: "Assign to team member",
  set_priority: "Set priority",
  require_human_review: "Require human review",
  flag_unresolved: "Flag as unresolved",
  require_approval: "Require approval for actions",
};

const ACTIONS_BY_TRIGGER: Record<RuleTrigger, RuleActionType[]> = {
  "request.created": ["process_with_ai", "assign_to", "set_priority"],
  "request.classified": ["assign_to", "set_priority", "require_human_review"],
  "request.unresolved_check": ["flag_unresolved"],
  "proposal.created": ["require_approval"],
};

export const ruleInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(""),
    is_enabled: z.boolean().default(true),
    trigger: z.enum(RULE_TRIGGERS),
    conditions: z.array(conditionSchema).max(5).default([]),
    action: ruleActionSchema,
    requires_approval: z.boolean().default(false),
    sort_order: z.number().int().min(0).max(10_000).default(100),
  })
  .superRefine((rule, ctx) => {
    if (!ACTIONS_BY_TRIGGER[rule.trigger].includes(rule.action.type)) {
      ctx.addIssue({ code: "custom", path: ["action"], message: `"${RULE_ACTION_LABELS[rule.action.type]}" is not supported for this trigger.` });
    }
    rule.conditions.forEach((c, i) => {
      if (!FIELDS_BY_TRIGGER[rule.trigger].includes(c.field)) {
        ctx.addIssue({ code: "custom", path: ["conditions", i, "field"], message: `"${CONDITION_FIELDS[c.field].label}" is not available for this trigger.` });
        return;
      }
      const kind = CONDITION_FIELDS[c.field].type;
      const valid =
        (kind === "number" && typeof c.value === "number" && ["eq", "neq", "gte", "lte"].includes(c.op)) ||
        (kind === "boolean" && typeof c.value === "boolean" && ["eq", "neq"].includes(c.op)) ||
        (kind === "string" &&
          ((c.op === "in" && Array.isArray(c.value)) || (["eq", "neq"].includes(c.op) && typeof c.value === "string")));
      if (!valid) {
        ctx.addIssue({ code: "custom", path: ["conditions", i], message: `Unsupported operator or value for "${CONDITION_FIELDS[c.field].label}".` });
      }
      if (c.field === "channel") {
        const values = Array.isArray(c.value) ? c.value : [c.value];
        if (values.some((v) => !(REQUEST_CHANNELS as readonly unknown[]).includes(v))) {
          ctx.addIssue({ code: "custom", path: ["conditions", i, "value"], message: "Unknown channel." });
        }
      }
      if (c.field === "action_type") {
        const values = Array.isArray(c.value) ? c.value : [c.value];
        if (values.some((v) => !(ACTION_TYPES as readonly unknown[]).includes(v))) {
          ctx.addIssue({ code: "custom", path: ["conditions", i, "value"], message: "Unknown action type." });
        }
      }
    });
    if (rule.requires_approval && rule.action.type !== "assign_to") {
      ctx.addIssue({
        code: "custom",
        path: ["requires_approval"],
        message: "Only assignment rules can be routed through approval. Other rule effects apply directly.",
      });
    }
  });

export type RuleInput = z.input<typeof ruleInputSchema>;
export type ValidRule = z.output<typeof ruleInputSchema>;

export type RuleFacts = Partial<Record<ConditionField, string | number | boolean | null>>;

/** Pure condition evaluation, shared by the engine and its tests. */
export function conditionsMatch(conditions: RuleCondition[], facts: RuleFacts): boolean {
  return conditions.every((c) => {
    const actual = facts[c.field];
    switch (c.op) {
      case "eq":
        return actual === c.value;
      case "neq":
        return actual !== c.value;
      case "in":
        return Array.isArray(c.value) && typeof actual === "string" && c.value.includes(actual);
      case "gte":
        return typeof actual === "number" && typeof c.value === "number" && actual >= c.value;
      case "lte":
        return typeof actual === "number" && typeof c.value === "number" && actual <= c.value;
    }
  });
}
