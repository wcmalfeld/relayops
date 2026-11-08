import { describe, expect, it } from "vitest";
import { conditionsMatch, ruleInputSchema } from "@/server/rules/schemas";

describe("workflow rule validation", () => {
  const base = { name: "r", trigger: "request.classified", conditions: [], action: { type: "set_priority", priority: "high" } };

  it("accepts a valid rule", () => {
    expect(ruleInputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects effects not allowed for the trigger", () => {
    expect(ruleInputSchema.safeParse({ ...base, action: { type: "flag_unresolved", after_hours: 3 } }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...base, trigger: "request.created", action: { type: "require_human_review", reason: "x" } }).success).toBe(false);
  });

  it("rejects unsupported actions and conditions", () => {
    expect(ruleInputSchema.safeParse({ ...base, action: { type: "send_email", to: "x" } }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...base, conditions: [{ field: "sql", op: "eq", value: "1" }] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...base, conditions: [{ field: "evidence_count", op: "in", value: ["1"] }] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...base, trigger: "request.created", action: { type: "process_with_ai" }, conditions: [{ field: "category", op: "eq", value: "x" }] }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ ...base, trigger: "proposal.created", action: { type: "require_approval", action_types: ["issue_refund"] } }).success).toBe(false);
  });

  it("only lets assignment rules route through approval", () => {
    expect(ruleInputSchema.safeParse({ ...base, requires_approval: true }).success).toBe(false);
  });

  it("evaluates conditions deterministically", () => {
    expect(conditionsMatch([{ field: "evidence_count", op: "lte", value: 0 }], { evidence_count: 0 })).toBe(true);
    expect(conditionsMatch([{ field: "category", op: "in", value: ["booking", "service_repair"] }], { category: "booking" })).toBe(true);
    expect(conditionsMatch([{ field: "category", op: "in", value: ["booking"] }, { field: "injection_suspected", op: "eq", value: true }], { category: "booking", injection_suspected: false })).toBe(false);
    expect(conditionsMatch([], {})).toBe(true);
  });
});
