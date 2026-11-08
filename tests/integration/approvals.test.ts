import { describe, expect, it } from "vitest";
import { withTenant } from "@/server/db/tenant";
import { createManualProposal, decideProposal, editProposal, submitProposal } from "@/server/actions/proposals";
import { executeProposal } from "@/server/actions/execute";
import { ctxFor, newRequest, proposalsOf, auditOf, rawAsApp } from "../helpers/fixtures";

async function responseProposal() {
  const maya = await ctxFor("maya");
  const req = await newRequest(maya);
  const p = await createManualProposal(maya, {
    requestId: req,
    actionType: "draft_customer_response",
    params: { to_email: "taylor.brooks@example.com", subject: "Re: order", body: "Your order is being prepared." },
    explanation: "Reply",
  });
  return { maya, req, p };
}

describe("approval gate (tests 7, 12, 17)", () => {
  it("requires approval for high-risk actions and refuses to execute without it", async () => {
    const { maya, req, p } = await responseProposal();
    expect(p.requires_approval).toBe(true);
    expect(p.risk_level).toBe("high");
    await expect(executeProposal(maya, p.id, p.version)).rejects.toMatchObject({ code: "conflict" });
    await submitProposal(maya, p.id, p.version);
    await expect(executeProposal(maya, p.id, p.version)).rejects.toMatchObject({ code: "conflict" });
    const audit = await auditOf(maya, req);
    expect(audit.filter((e) => e.event_type === "action.execution_denied")).toHaveLength(2);
  });

  it("only owners can approve; members cannot, even with the right hash", async () => {
    const { maya, p } = await responseProposal();
    const priya = await ctxFor("priya");
    await submitProposal(priya, p.id, p.version);
    await expect(decideProposal(priya, p.id, { decision: "approved", expectedVersion: 1, expectedParamsHash: p.params_hash })).rejects.toMatchObject({ code: "forbidden" });
    // Bypassing the service: the runtime role still cannot record an approval for a member.
    await rawAsApp({ actor: "user", userId: priya.userId, businessId: priya.businessId }, async (q) => {
      await expect(q("insert into action_approvals (business_id, proposal_id, proposal_version, params_hash, decision, decided_by) values ($1, $2, 1, $3, 'approved', $4)", [priya.businessId, p.id, p.params_hash, priya.userId])).rejects.toMatchObject({ code: "42501" });
    });
    await decideProposal(maya, p.id, { decision: "approved", expectedVersion: 1, expectedParamsHash: p.params_hash });
    expect((await proposalsOf(maya, p.request_id))[0].status).toBe("approved");
  });

  it("refuses a decision made against stale values", async () => {
    const { maya, p } = await responseProposal();
    await submitProposal(maya, p.id, p.version);
    await expect(decideProposal(maya, p.id, { decision: "approved", expectedVersion: 1, expectedParamsHash: "0".repeat(64) })).rejects.toMatchObject({ code: "conflict" });
    await expect(decideProposal(maya, p.id, { decision: "approved", expectedVersion: 2, expectedParamsHash: p.params_hash })).rejects.toMatchObject({ code: "conflict" });
  });

  it("cannot be bypassed by updating the status directly in the database", async () => {
    const { maya, p } = await responseProposal();
    await rawAsApp({ actor: "user", userId: maya.userId, businessId: maya.businessId }, async (q) => {
      await expect(q("update action_proposals set status = 'executing' where id = $1", [p.id])).rejects.toMatchObject({ code: "23514" });
    });
    await rawAsApp({ actor: "user", userId: maya.userId, businessId: maya.businessId }, async (q) => {
      await expect(q("update action_proposals set requires_approval = false where id = $1", [p.id])).rejects.toMatchObject({ code: "23514" });
    });
    await rawAsApp({ actor: "user", userId: maya.userId, businessId: maya.businessId }, async (q) => {
      await expect(q("update action_proposals set status = 'approved' where id = $1", [p.id])).rejects.toMatchObject({ code: "23514" });
    });
  });
});

describe("approval binding (test 13)", () => {
  it("invalidates an approval when parameters change", async () => {
    const { maya, p } = await responseProposal();
    await submitProposal(maya, p.id, 1);
    await decideProposal(maya, p.id, { decision: "approved", expectedVersion: 1, expectedParamsHash: p.params_hash });
    const edit = await editProposal(maya, p.id, { params: { to_email: "taylor.brooks@example.com", subject: "Re: order", body: "Changed after approval." }, expectedVersion: 1 });
    expect(edit).toMatchObject({ version: 2, changed: true });
    const after = (await proposalsOf(maya, p.request_id))[0];
    expect(after.status).toBe("draft");
    expect(after.params_hash).not.toBe(p.params_hash);
    await expect(executeProposal(maya, p.id, 2)).rejects.toMatchObject({ code: "conflict" });
    const approvals = await withTenant(maya, (tx) => tx.many<{ invalidated_at: Date | null; invalidation_reason: string | null }>("select invalidated_at, invalidation_reason from action_approvals where proposal_id = $1", [p.id]));
    expect(approvals).toHaveLength(1);
    expect(approvals[0].invalidation_reason).toBe("parameters_changed");
    const revisions = await withTenant(maya, (tx) => tx.many("select version from action_proposal_revisions where proposal_id = $1 order by version", [p.id]));
    expect(revisions).toHaveLength(2);
    // Re-approval of the new version is required and then works.
    await submitProposal(maya, p.id, 2);
    await decideProposal(maya, p.id, { decision: "approved", expectedVersion: 2, expectedParamsHash: after.params_hash });
    await expect(executeProposal(maya, p.id, 2)).resolves.toMatchObject({ status: "executed" });
  });

  it("refuses to execute when the caller saw an older version", async () => {
    const { maya, p } = await responseProposal();
    await editProposal(maya, p.id, { params: { ...(p.params as object), body: "v2" }, expectedVersion: 1 });
    await expect(editProposal(maya, p.id, { params: { ...(p.params as object), body: "v3" }, expectedVersion: 1 })).rejects.toMatchObject({ code: "conflict" });
  });

  it("does not allow the recipient to be changed to an arbitrary address", async () => {
    const { maya, p } = await responseProposal();
    await expect(editProposal(maya, p.id, { params: { ...(p.params as object), to_email: "attacker@evil.example" }, expectedVersion: 1 })).rejects.toMatchObject({ code: "validation" });
  });
});

describe("execution (tests 14, 15)", () => {
  it("executes exactly once under concurrent attempts", async () => {
    const { maya, req, p } = await responseProposal();
    await submitProposal(maya, p.id, 1);
    await decideProposal(maya, p.id, { decision: "approved", expectedVersion: 1, expectedParamsHash: p.params_hash });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => executeProposal(maya, p.id, 1)));
    const executed = results.filter((r) => r.status === "fulfilled" && r.value.status === "executed");
    expect(executed).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(4);
    const deliveries = await withTenant(maya, (tx) => tx.many("select id from message_deliveries where proposal_id = $1", [p.id]));
    expect(deliveries).toHaveLength(1);
    const runs = await withTenant(maya, (tx) => tx.many("select status from workflow_executions where proposal_id = $1 and status = 'succeeded'", [p.id]));
    expect(runs).toHaveLength(1);
    await expect(executeProposal(maya, p.id, 1)).rejects.toMatchObject({ code: "conflict" });
    const req2 = await withTenant(maya, (tx) => tx.one<{ status: string }>("select status from customer_requests where id = $1", [req]));
    expect(req2.status).toBe("completed");
  });

  it("records simulated delivery as simulated", async () => {
    const { maya, req, p } = await responseProposal();
    await submitProposal(maya, p.id, 1);
    await decideProposal(maya, p.id, { decision: "approved", expectedVersion: 1, expectedParamsHash: p.params_hash });
    const out = await executeProposal(maya, p.id, 1);
    expect(out.status === "executed" && out.summary).toMatch(/simulated/i);
    const d = await withTenant(maya, (tx) => tx.one<{ simulated: boolean; provider: string; status: string }>("select simulated, provider, status from message_deliveries where proposal_id = $1", [p.id]));
    expect(d).toEqual({ simulated: true, provider: "mock", status: "simulated_delivered" });
    const events = (await auditOf(maya, req)).map((e) => e.event_type);
    expect(events).toEqual(expect.arrayContaining(["approval.granted", "action.execution_started", "delivery.simulated", "action.executed"]));
  });

  it("records failures clearly and does not mark them completed", async () => {
    const maya = await ctxFor("maya");
    const req = await newRequest(maya, { customer_name: "Jordan Blake", customer_email: "jordan.blake@mailbox.invalid", subject: "Tracking?", body: "Where is SC-10447?" });
    const p = await createManualProposal(maya, { requestId: req, actionType: "draft_customer_response", params: { to_email: "jordan.blake@mailbox.invalid", subject: "Re", body: "Hi" }, explanation: "x" });
    await submitProposal(maya, p.id, 1);
    await decideProposal(maya, p.id, { decision: "approved", expectedVersion: 1, expectedParamsHash: p.params_hash });
    const out = await executeProposal(maya, p.id, 1);
    expect(out.status).toBe("failed");
    const row = (await proposalsOf(maya, req))[0];
    expect(row.status).toBe("failed");
    const reqRow = await withTenant(maya, (tx) => tx.one<{ status: string }>("select status from customer_requests where id = $1", [req]));
    expect(reqRow.status).toBe("failed");
    const events = await auditOf(maya, req);
    expect(events.some((e) => e.event_type === "action.execution_failed" && e.result === "failure")).toBe(true);
    expect(events.some((e) => e.event_type === "action.executed")).toBe(false);
    const execs = await withTenant(maya, (tx) => tx.many<{ status: string }>("select status from workflow_executions where proposal_id = $1", [p.id]));
    expect(execs.map((e) => e.status)).toEqual(["failed"]);
  });

  it("re-checks records at execution time (slot taken in the meantime)", async () => {
    const maya = await ctxFor("maya");
    const req = await newRequest(maya, { customer_name: "Jamie Lee", customer_email: "jamie.lee@example.org", subject: "Book", body: "Book a tune-up" });
    const ids = await withTenant(maya, (tx) =>
      tx.one<{ slot: string; customer: string; other: string }>(
        `select (select id from appointments where status = 'available' and service_type = 'any' and starts_at > now() order by starts_at desc limit 1) as slot,
                (select id from customers where email = 'jamie.lee@example.org') as customer,
                (select id from customers where email = 'pat.kim@example.com') as other`,
      ),
    );
    const p = await createManualProposal(maya, { requestId: req, actionType: "propose_appointment", params: { appointment_slot_id: ids.slot, customer_id: ids.customer, service_type: "tune_up" }, explanation: "x" });
    await submitProposal(maya, p.id, 1);
    await decideProposal(maya, p.id, { decision: "approved", expectedVersion: 1, expectedParamsHash: p.params_hash });
    await withTenant(maya, (tx) => tx.exec("update appointments set status = 'booked', customer_id = $2 where id = $1", [ids.slot, ids.other]));
    const out = await executeProposal(maya, p.id, 1);
    expect(out.status).toBe("failed");
  });

  it("lets members execute medium-risk actions directly", async () => {
    const priya = await ctxFor("priya");
    const req = await newRequest(priya);
    const p = await createManualProposal(priya, { requestId: req, actionType: "add_internal_note", params: { body: "Called the customer" }, explanation: "x" });
    expect(p.requires_approval).toBe(false);
    await expect(executeProposal(priya, p.id, 1)).resolves.toMatchObject({ status: "executed" });
  });

  it("rules can add an approval requirement but never remove one", async () => {
    const maya = await ctxFor("maya");
    const req = await newRequest(maya, { subject: "Return my bike", body: "I want to return it for a refund" });
    await withTenant(maya, (tx) => tx.exec("update customer_requests set category = 'return_refund' where id = $1", [req]));
    const p = await createManualProposal(maya, { requestId: req, actionType: "update_request_status", params: { status: "completed", reason: "Handled by phone" }, explanation: "x" });
    expect(p.requires_approval).toBe(true); // seeded rule: status changes on returns need approval
  });
});
