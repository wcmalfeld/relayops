import { describe, expect, it } from "vitest";
import { createRequest } from "@/server/intake/intake-service";
import { withTenant } from "@/server/db/tenant";
import { AppError } from "@/server/errors";
import { ctxFor, auditOf } from "../helpers/fixtures";

describe("request intake (tests 1, 2)", () => {
  it("creates a request linked to the matching customer and audits it", async () => {
    const priya = await ctxFor("priya");
    const r = await createRequest(priya, { customer_name: "Casey Nguyen", customer_email: "CASEY.NGUYEN@example.com", subject: "Helmet?", body: "Do you have helmets?" }, "manual");
    expect(r.reference).toMatch(/^REQ-\d+$/);
    const row = await withTenant(priya, (tx) => tx.one<{ customer_id: string | null; status: string; created_by: string }>("select customer_id, status, created_by from customer_requests where id = $1", [r.id]));
    expect(row.customer_id).not.toBeNull();
    expect(row.status).toBe("new");
    expect(row.created_by).toBe(priya.userId);
    const audit = await auditOf(priya, r.id);
    expect(audit[0].event_type).toBe("request.created");
    expect(JSON.stringify(audit[0].metadata)).not.toContain("helmets");
  });

  it("rejects malformed input with field errors", async () => {
    const priya = await ctxFor("priya");
    const bad = [
      {},
      { customer_name: "", subject: "x", body: "y" },
      { customer_name: "A", customer_email: "nope", subject: "x", body: "y" },
      { customer_name: "A", subject: "x", body: "y".repeat(8001) },
      { customer_name: "A", subject: "x", body: "y", business_id: priya.businessId },
      { customer_name: "A", subject: "x", body: "y", received_at: new Date(Date.now() + 86_400_000).toISOString() },
    ];
    for (const input of bad) {
      await expect(createRequest(priya, input, "manual")).rejects.toMatchObject({ code: "validation" });
    }
    try {
      await createRequest(priya, { customer_name: "", subject: "", body: "" }, "manual");
    } catch (e) {
      expect((e as AppError).details?.customer_name).toBeTruthy();
    }
  });

  it("is idempotent for integrations that retry", async () => {
    const priya = await ctxFor("priya");
    const input = { customer_name: "API", subject: "s", body: "b", idempotency_key: `test-${Date.now()}` };
    const a = await createRequest(priya, input, "manual");
    const b = await createRequest(priya, input, "manual");
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
  });

  it("does not let a scheduler context create requests", async () => {
    const maya = await ctxFor("maya");
    await expect(createRequest({ kind: "system", businessId: maya.businessId, source: "scheduler" }, { customer_name: "x", subject: "s", body: "b" }, "api")).rejects.toMatchObject({ code: "forbidden" });
  });
});
