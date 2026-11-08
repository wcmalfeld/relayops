import { describe, expect, it } from "vitest";
import { sanitizeMetadata } from "@/server/audit/sanitize";

describe("audit metadata sanitizer (test 20)", () => {
  it("drops message content, contact details and credentials", () => {
    const out = sanitizeMetadata({
      body: "My card number is 4111...",
      customer_email: "jane@example.com",
      password: "hunter2",
      api_key: "sk-abcdefghijklmnop",
      prompt: "system prompt text",
      note: "contact me at jane@example.com",
      header: "Bearer abcdefghijklmnopqrstu",
      action_type: "add_internal_note",
      count: 3,
    });
    expect(out.body).toBe("[redacted]");
    expect(out.customer_email).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.api_key).toBe("[redacted]");
    expect(out.prompt).toBe("[redacted]");
    expect(out.note).toBe("[redacted]");
    expect(out.header).toBe("[redacted]");
    expect(out.action_type).toBe("add_internal_note");
    expect(out.count).toBe(3);
  });

  it("truncates long strings and bounds depth", () => {
    const out = sanitizeMetadata({ reason: "x".repeat(500), deep: { a: { b: { c: { d: 1 } } } } });
    expect(String(out.reason).length).toBeLessThanOrEqual(161);
    expect(JSON.stringify(out.deep)).toContain("[truncated]");
  });

  it("returns an object for non-object input", () => {
    expect(sanitizeMetadata("hello")).toEqual({});
    expect(sanitizeMetadata(null)).toEqual({});
  });
});
