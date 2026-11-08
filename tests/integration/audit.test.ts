import { describe, expect, it } from "vitest";
import { withTenant } from "@/server/db/tenant";
import { processRequest } from "@/server/ai/pipeline";
import { MockAIService } from "@/server/ai/providers/mock";
import { ctxFor, newRequest, rawAsApp } from "../helpers/fixtures";
import { login } from "@/server/auth/session-service";

describe("audit log (test 20)", () => {
  it("stores no message content, contact details or secrets in metadata", async () => {
    const maya = await ctxFor("maya");
    const secretPhrase = "my-unique-secret-phrase-7731";
    const req = await newRequest(maya, { customer_name: "Casey Nguyen", customer_email: "casey.nguyen@example.com", subject: "Helmet", body: `Is the helmet in stock? ${secretPhrase}` });
    await processRequest(maya, req, new MockAIService());
    await login({ email: "owner@summitcycles.example", password: "relayops-demo-2026" }, { ip: "127.0.0.1", userAgent: "vitest" });
    const all = await withTenant(maya, (tx) => tx.many<{ metadata: unknown }>("select metadata from audit_events"));
    const blob = JSON.stringify(all);
    expect(blob).not.toContain(secretPhrase);
    expect(blob).not.toContain("casey.nguyen@example.com");
    expect(blob).not.toMatch(/relayops-demo-2026|scrypt\$|ro_live_[A-Za-z0-9_-]{20}/);
  });

  it("is append-only for every role", async () => {
    const maya = await ctxFor("maya");
    await rawAsApp({ actor: "user", userId: maya.userId, businessId: maya.businessId }, async (q) => {
      await expect(q("update audit_events set result = 'success'")).rejects.toMatchObject({ code: "42501" });
    });
    await rawAsApp({ actor: "user", userId: maya.userId, businessId: maya.businessId }, async (q) => {
      await expect(q("delete from audit_events")).rejects.toMatchObject({ code: "42501" });
    });
    await rawAsApp({ actor: "user", userId: maya.userId, businessId: maya.businessId }, async (q) => {
      await expect(q("insert into audit_events (business_id, event_type, actor_type, actor_user_id, result) values ($1, 'fake.event', 'user', (select id from profiles where email = 'frontdesk@summitcycles.example'), 'success')", [maya.businessId])).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("keeps credentials and sessions unreadable to the runtime role", async () => {
    const maya = await ctxFor("maya");
    await rawAsApp({ actor: "user", userId: maya.userId, businessId: maya.businessId }, async (q) => {
      await expect(q("select * from auth_credentials")).rejects.toMatchObject({ code: "42501" });
    });
    await rawAsApp({ actor: "user", userId: maya.userId, businessId: maya.businessId }, async (q) => {
      await expect(q("select * from auth_sessions")).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("authentication", () => {
  it("rejects wrong passwords with a generic message", async () => {
    await expect(login({ email: "owner@summitcycles.example", password: "wrong" }, { ip: "10.0.0.9" })).rejects.toMatchObject({ code: "unauthenticated", message: "Email or password is incorrect." });
    await expect(login({ email: "nobody@example.com", password: "wrong" }, { ip: "10.0.0.9" })).rejects.toMatchObject({ code: "unauthenticated", message: "Email or password is incorrect." });
  });
});
