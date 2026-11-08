import { describe, expect, it } from "vitest";
import { withTenant } from "@/server/db/tenant";
import { getRequestDetail, listRequests } from "@/server/requests/queries";
import { createManualProposal, decideProposal } from "@/server/actions/proposals";
import { executeProposal } from "@/server/actions/execute";
import { ctxFor, newRequest, rawAsApp, proposalsOf } from "../helpers/fixtures";

describe("tenant isolation and manipulated identifiers (tests 6, 9)", () => {
  it("never returns another business's records, even by direct id", async () => {
    const maya = await ctxFor("maya");
    const sam = await ctxFor("sam");
    const summitReq = await newRequest(maya);
    await expect(getRequestDetail(sam, summitReq)).rejects.toMatchObject({ code: "not_found" });
    const list = await listRequests(sam, { page: 1, q: "SC-10433" });
    expect(list.rows.every((r) => !r.subject.includes("SC-10433"))).toBe(true);
    const counts = await withTenant(sam, (tx) => tx.one<{ products: number; customers: number }>("select (select count(*)::int from products) as products, (select count(*)::int from customers) as customers"));
    expect(counts.products).toBe(1);
    expect(counts.customers).toBe(1);
  });

  it("ignores a forged business id when the user is not a member", async () => {
    const maya = await ctxFor("maya");
    const sam = await ctxFor("sam");
    await rawAsApp({ actor: "user", userId: sam.userId, businessId: maya.businessId }, async (q) => {
      expect(await q("select id from customer_requests")).toHaveLength(0);
      expect(await q("select id from customers")).toHaveLength(0);
      expect(await q("select id from orders")).toHaveLength(0);
    });
    // No actor at all: nothing is visible.
    await rawAsApp({ actor: "", businessId: maya.businessId }, async (q) => {
      expect(await q("select id from products")).toHaveLength(0);
    });
  });

  it("rejects writes that reference another tenant's records", async () => {
    const maya = await ctxFor("maya");
    const sam = await ctxFor("sam");
    const req = await newRequest(maya);
    const harborCustomer = await withTenant(sam, (tx) => tx.one<{ id: string }>("select id from customers limit 1"));
    const harborOrder = await withTenant(sam, (tx) => tx.one<{ id: string }>("select id from orders limit 1"));
    const samUser = sam.userId;
    await expect(createManualProposal(maya, { requestId: req, actionType: "assign_team_member", params: { assignee_user_id: samUser }, explanation: "x" })).rejects.toMatchObject({ code: "validation" });
    await expect(
      createManualProposal(maya, { requestId: req, actionType: "prepare_refund_request", params: { order_id: harborOrder.id, customer_id: harborCustomer.id, amount_cents: 100, reason: "x" }, explanation: "x" }),
    ).rejects.toMatchObject({ code: "validation" });
    // A Harbor owner cannot act on a Summit request id.
    await expect(createManualProposal(sam, { requestId: req, actionType: "add_internal_note", params: { body: "hi" }, explanation: "x" })).rejects.toMatchObject({ code: "not_found" });
    // Raw SQL with a cross-tenant composite reference fails the foreign key.
    await rawAsApp({ actor: "user", userId: maya.userId, businessId: maya.businessId }, async (q) => {
      await expect(q("insert into orders (business_id, order_number, customer_id, status, fulfillment, total_cents, placed_at) values ($1, 'X-1', $2, 'pending', 'ship', 1, now())", [maya.businessId, harborCustomer.id])).rejects.toMatchObject({ code: "23503" });
    });
  });

  it("does not let one tenant's owner approve or execute another tenant's proposal", async () => {
    const maya = await ctxFor("maya");
    const sam = await ctxFor("sam");
    const req = await newRequest(maya);
    const p = await createManualProposal(maya, { requestId: req, actionType: "add_internal_note", params: { body: "note" }, explanation: "x" });
    await expect(executeProposal(sam, p.id, p.version)).rejects.toMatchObject({ code: "not_found" });
    await expect(decideProposal(sam, p.id, { decision: "approved", expectedVersion: 1, expectedParamsHash: p.params_hash })).rejects.toMatchObject({ code: "not_found" });
    expect((await proposalsOf(maya, req))[0].status).toBe("draft");
  });

  it("limits members to assigned and unassigned requests", async () => {
    const maya = await ctxFor("maya");
    const priya = await ctxFor("priya");
    const jordan = await ctxFor("jordan");
    const req = await newRequest(maya);
    const assign = await createManualProposal(maya, { requestId: req, actionType: "assign_team_member", params: { assignee_user_id: jordan.userId }, explanation: "x" });
    await executeProposal(maya, assign.id, assign.version);
    await expect(getRequestDetail(priya, req)).rejects.toMatchObject({ code: "not_found" });
    await expect(getRequestDetail(jordan, req)).resolves.toBeTruthy();
  });
});
