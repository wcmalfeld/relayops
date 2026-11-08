import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/requests/route";
import { createIntakeKey } from "@/server/team/service";
import { withTenant } from "@/server/db/tenant";
import { ctxFor } from "../helpers/fixtures";

const call = (body: unknown, auth?: string) =>
  POST(new NextRequest("http://localhost/api/v1/requests", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }));

describe("intake API", () => {
  it("requires a valid key, and the key decides the business", async () => {
    expect((await call({ customer_name: "x", subject: "s", body: "b" })).status).toBe(401);
    expect((await call({ customer_name: "x", subject: "s", body: "b" }, "Bearer ro_live_notarealkeynotarealkey00")).status).toBe(401);

    const sam = await ctxFor("sam");
    const maya = await ctxFor("maya");
    const { secret } = await createIntakeKey(sam, "test key");
    // Trying to target another tenant through the payload is rejected outright.
    const forged = await call({ customer_name: "x", subject: "s", body: "b", business_id: maya.businessId }, `Bearer ${secret}`);
    expect(forged.status).toBe(422);

    const ok = await call({ customer_name: "Robin Hale", customer_email: "robin.hale@example.com", subject: "API test", body: "Hello from the website" }, `Bearer ${secret}`);
    expect(ok.status).toBe(201);
    const { id } = await ok.json();
    const inHarbor = await withTenant(sam, (tx) => tx.maybeOne("select 1 from customer_requests where id = $1", [id]));
    const inSummit = await withTenant(maya, (tx) => tx.maybeOne("select 1 from customer_requests where id = $1", [id]));
    expect(inHarbor).not.toBeNull();
    expect(inSummit).toBeNull();
  });
});
