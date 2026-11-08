import { describe, expect, it } from "vitest";
import { parseAction, riskFor, AI_PROPOSABLE_ACTIONS } from "@/server/actions/registry";
import { ACTION_TYPES } from "@/lib/domain";

const uuid = "8a1f0c4e-2b3d-4e5f-9a6b-7c8d9e0f1a2b";

describe("action registry (tests 10, 11)", () => {
  it("accepts every supported action with valid parameters", () => {
    const valid: Record<string, unknown> = {
      draft_customer_response: { to_email: "A@Example.com", subject: "Re: hi", body: "Hello" },
      update_request_status: { status: "completed", reason: "Answered" },
      assign_team_member: { assignee_user_id: uuid },
      add_internal_note: { body: "Call back tomorrow" },
      create_service_request: { customer_id: uuid, bike_description: "Commuter", issue_summary: "Brakes", service_type: "brake_service" },
      propose_appointment: { appointment_slot_id: uuid, customer_id: uuid, service_type: "tune_up" },
      prepare_refund_request: { order_id: uuid, customer_id: uuid, amount_cents: 1000, reason: "Too small" },
    };
    for (const t of ACTION_TYPES) {
      const r = parseAction(t, valid[t]);
      expect(r.ok, t).toBe(true);
    }
    const r = parseAction("draft_customer_response", valid.draft_customer_response);
    expect(r.ok && (r.params as { to_email: string }).to_email).toBe("a@example.com");
  });

  it("rejects unknown action types, including dangerous ones", () => {
    for (const t of ["issue_refund", "transfer_money", "grant_admin_access", "run_sql", "delete_customers", "", null, 42]) {
      const r = parseAction(t, {});
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("unknown_action_type");
    }
  });

  it("rejects unexpected fields, invalid identifiers and unsupported values", () => {
    expect(parseAction("assign_team_member", { assignee_user_id: uuid, role: "owner" }).ok).toBe(false);
    expect(parseAction("assign_team_member", { assignee_user_id: "1 OR 1=1" }).ok).toBe(false);
    expect(parseAction("update_request_status", { status: "approved", reason: "x" }).ok).toBe(false);
    expect(parseAction("prepare_refund_request", { order_id: uuid, customer_id: uuid, amount_cents: -5, reason: "x" }).ok).toBe(false);
    expect(parseAction("prepare_refund_request", { order_id: uuid, customer_id: uuid, amount_cents: 10.5, reason: "x" }).ok).toBe(false);
    expect(parseAction("draft_customer_response", { to_email: "not-an-email", subject: "s", body: "b" }).ok).toBe(false);
    expect(parseAction("add_internal_note", { body: "x".repeat(2001) }).ok).toBe(false);
    expect(parseAction("propose_appointment", { appointment_slot_id: uuid, customer_id: uuid, service_type: "teleport" }).ok).toBe(false);
  });

  it("assigns risk in code: external or record-changing actions are high risk", () => {
    expect(riskFor("draft_customer_response")).toBe("high");
    expect(riskFor("propose_appointment")).toBe("high");
    expect(riskFor("prepare_refund_request")).toBe("high");
    expect(riskFor("create_service_request")).toBe("high");
    expect(riskFor("add_internal_note")).toBe("medium");
    expect(AI_PROPOSABLE_ACTIONS).not.toContain("draft_customer_response");
  });
});
