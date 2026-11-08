import "server-only";
import { z } from "zod";
import { env } from "@/server/env";
import { AIError, type AIResult, type AIService } from "@/server/ai/service";
import { postJsonWithRetry } from "@/server/ai/http";
import { classifyPrompt, draftPrompt, proposePrompt, summarizePrompt } from "@/server/ai/prompts";
import {
  classificationOutputSchema,
  draftOutputSchema,
  proposalOutputSchema,
  summaryOutputSchema,
  type ClassifyInput,
  type DraftInput,
  type ProposeInput,
  type SummarizeInput,
} from "@/server/ai/schemas";

/** Low-level transport: one structured-JSON call to a hosted model. */
export interface JsonTransport {
  readonly provider: string;
  readonly model: string;
  generate(req: { system: string; user: string; name: string; schema: Record<string, unknown>; maxTokens: number }): Promise<AIResult>;
}

function jsonSchemaFor(schema: z.ZodType) {
  const s = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

const SCHEMAS = {
  classify: jsonSchemaFor(classificationOutputSchema),
  summarize: jsonSchemaFor(summaryOutputSchema),
  draft: jsonSchemaFor(draftOutputSchema),
  propose: jsonSchemaFor(proposalOutputSchema),
};

function maybeLogPrompt(task: string, prompt: { system: string; user: string }) {
  // Off by default: prompts contain customer messages.
  if (env().AI_LOG_PROMPTS) console.info(`[relayops][ai][${task}]`, prompt.user.slice(0, 4000));
}

/** AIService backed by any hosted model reachable through a JsonTransport. */
export class LlmAIService implements AIService {
  constructor(private readonly transport: JsonTransport) {}

  get provider() {
    return this.transport.provider;
  }
  get model() {
    return this.transport.model;
  }

  classify(input: ClassifyInput) {
    const p = classifyPrompt(input);
    maybeLogPrompt("classify", p);
    return this.transport.generate({ ...p, name: "record_classification", schema: SCHEMAS.classify, maxTokens: 800 });
  }
  summarize(input: SummarizeInput) {
    const p = summarizePrompt(input);
    maybeLogPrompt("summarize", p);
    return this.transport.generate({ ...p, name: "record_summary", schema: SCHEMAS.summarize, maxTokens: 500 });
  }
  draftResponse(input: DraftInput) {
    const p = draftPrompt(input);
    maybeLogPrompt("draft", p);
    return this.transport.generate({ ...p, name: "record_draft_response", schema: SCHEMAS.draft, maxTokens: 1800 });
  }
  proposeActions(input: ProposeInput) {
    const p = proposePrompt(input);
    maybeLogPrompt("propose", p);
    return this.transport.generate({ ...p, name: "record_action_proposals", schema: SCHEMAS.propose, maxTokens: 1200 });
  }
}

/** Anthropic Messages API, forcing a single tool call to obtain JSON. */
export class AnthropicTransport implements JsonTransport {
  readonly provider = "anthropic";
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async generate(req: { system: string; user: string; name: string; schema: Record<string, unknown>; maxTokens: number }): Promise<AIResult> {
    const { json, attempts } = await postJsonWithRetry(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        tools: [{ name: req.name, description: "Return the structured result.", input_schema: req.schema }],
        tool_choice: { type: "tool", name: req.name },
      },
      { timeoutMs: env().AI_TIMEOUT_MS, maxRetries: env().AI_MAX_RETRIES, fetchImpl: this.fetchImpl },
    );
    const body = json as { content?: { type: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const tool = body.content?.find((c) => c.type === "tool_use");
    if (!tool) throw new AIError("bad_response", "AI provider returned no structured output", attempts);
    return {
      output: tool.input,
      usage: { inputTokens: body.usage?.input_tokens ?? null, outputTokens: body.usage?.output_tokens ?? null },
      attempts,
    };
  }
}

/** OpenAI-compatible Chat Completions with JSON-schema response format. */
export class OpenAITransport implements JsonTransport {
  readonly provider = "openai";
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async generate(req: { system: string; user: string; name: string; schema: Record<string, unknown>; maxTokens: number }): Promise<AIResult> {
    const { json, attempts } = await postJsonWithRetry(
      `${this.baseUrl.replace(/\/$/, "")}/chat/completions`,
      { authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        max_completion_tokens: req.maxTokens,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        response_format: { type: "json_schema", json_schema: { name: req.name, schema: req.schema, strict: false } },
      },
      { timeoutMs: env().AI_TIMEOUT_MS, maxRetries: env().AI_MAX_RETRIES, fetchImpl: this.fetchImpl },
    );
    const body = json as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new AIError("bad_response", "AI provider returned no content", attempts);
    let output: unknown;
    try {
      output = JSON.parse(content);
    } catch {
      throw new AIError("bad_response", "AI provider returned malformed JSON", attempts);
    }
    return {
      output,
      usage: { inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null },
      attempts,
    };
  }
}
