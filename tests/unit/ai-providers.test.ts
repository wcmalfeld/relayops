import { describe, expect, it } from "vitest";
import { postJsonWithRetry } from "@/server/ai/http";
import { AnthropicTransport, OpenAITransport, LlmAIService } from "@/server/ai/providers/llm";
import { MockAIService } from "@/server/ai/providers/mock";
import { classificationOutputSchema, draftOutputSchema } from "@/server/ai/schemas";
import { AIError } from "@/server/ai/service";

const categories = ["order_status", "product_availability", "service_repair", "booking", "return_refund", "product_info", "general_question", "other"].map((key) => ({ key, label: key, description: "" }));
const req = (subject: string, body: string) => ({ reference: "REQ-1", subject, body, customerName: "Casey Nguyen", customerMatched: true, receivedAt: new Date().toISOString() });

describe("mock AI provider (test 3)", () => {
  const ai = new MockAIService();

  it.each([
    ["Where is order SC-10433?", "Has it shipped?", "order_status"],
    ["Ridgeline in medium?", "Do you have the Ridgeline Trail 29 in stock?", "product_availability"],
    ["Book a tune-up", "Can I book an appointment Saturday?", "booking"],
    ["Return", "I want to return my bike for a refund", "return_refund"],
    ["Brakes", "My brakes squeak, can you fix them?", "service_repair"],
    ["hmm", "is it ready", "other"],
  ])("classifies %s as %s", async (subject, body, expected) => {
    const res = await ai.classify({ request: req(subject, body), categories });
    const parsed = classificationOutputSchema.parse(res.output);
    expect(parsed.category).toBe(expected);
  });

  it("extracts order numbers and flags missing information", async () => {
    const res = classificationOutputSchema.parse((await ai.classify({ request: req("order", "Where is order SC10433?"), categories })).output);
    expect(res.extracted.order_number).toBe("SC-10433");
    const vague = classificationOutputSchema.parse((await ai.classify({ request: req("hi", "is it ready yet"), categories })).output);
    expect(vague.missing_information.length).toBeGreaterThan(0);
    expect(vague.uncertainty.level).toBe("high");
  });

  it("asks for information instead of inventing it when no records exist", async () => {
    const cls = classificationOutputSchema.parse((await ai.classify({ request: req("order", "Where is my order?"), categories })).output);
    const draft = draftOutputSchema.parse((await ai.draftResponse({ request: req("order", "Where is my order?"), classification: cls, evidence: [], retrievalNotes: [], businessName: "Shop", signOff: "Team" })).output);
    expect(draft.needs_human_review).toBe(true);
    expect(draft.body).toMatch(/order number/i);
    expect(draft.body).not.toMatch(/\$\d/);
  });
});

describe("HTTP retries and timeouts", () => {
  it("retries transient failures then succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls < 2 ? new Response("busy", { status: 503 }) : Response.json({ ok: true });
    }) as unknown as typeof fetch;
    const r = await postJsonWithRetry("https://x.test", {}, {}, { timeoutMs: 1000, maxRetries: 2, fetchImpl });
    expect(r.attempts).toBe(2);
    expect(r.json).toEqual({ ok: true });
  });

  it("does not retry client errors and stops after the retry limit", async () => {
    let calls = 0;
    const bad = (async () => {
      calls++;
      return new Response("nope", { status: 400 });
    }) as unknown as typeof fetch;
    await expect(postJsonWithRetry("https://x.test", {}, {}, { timeoutMs: 1000, maxRetries: 3, fetchImpl: bad })).rejects.toBeInstanceOf(AIError);
    expect(calls).toBe(1);

    calls = 0;
    const down = (async () => {
      calls++;
      return new Response("down", { status: 500 });
    }) as unknown as typeof fetch;
    await expect(postJsonWithRetry("https://x.test", {}, {}, { timeoutMs: 1000, maxRetries: 1, fetchImpl: down })).rejects.toMatchObject({ code: "unavailable" });
    expect(calls).toBe(2);
  });

  it("times out slow providers", async () => {
    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
    await expect(postJsonWithRetry("https://x.test", {}, {}, { timeoutMs: 50, maxRetries: 0, fetchImpl: slow })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("hosted provider adapters (simulated HTTP; no real API calls)", () => {
  it("reads the forced tool call from an Anthropic response", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ content: [{ type: "tool_use", name: "record_summary", input: { summary: "s", key_points: [] } }], usage: { input_tokens: 10, output_tokens: 5 } });
    }) as unknown as typeof fetch;
    const svc = new LlmAIService(new AnthropicTransport("test-model", "key", fetchImpl));
    const r = await svc.summarize({ request: req("a", "b"), category: "other" });
    expect(r.output).toEqual({ summary: "s", key_points: [] });
    expect(r.usage.inputTokens).toBe(10);
    expect((sent.tool_choice as { type: string }).type).toBe("tool");
    expect(String(sent.system)).toMatch(/untrusted DATA/);
  });

  it("parses OpenAI-compatible JSON content and rejects malformed JSON", async () => {
    const ok = (async () => Response.json({ choices: [{ message: { content: '{"summary":"x","key_points":[]}' } }] })) as unknown as typeof fetch;
    const r = await new OpenAITransport("m", "k", "https://api.test/v1", ok).generate({ system: "s", user: "u", name: "n", schema: {}, maxTokens: 10 });
    expect(r.output).toEqual({ summary: "x", key_points: [] });
    const bad = (async () => Response.json({ choices: [{ message: { content: "not json" } }] })) as unknown as typeof fetch;
    await expect(new OpenAITransport("m", "k", "https://api.test/v1", bad).generate({ system: "s", user: "u", name: "n", schema: {}, maxTokens: 10 })).rejects.toMatchObject({ code: "bad_response" });
  });
});
