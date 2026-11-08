import "server-only";
import { env } from "@/server/env";
import type { AIService } from "@/server/ai/service";
import { MockAIService, UnavailableAIService } from "@/server/ai/providers/mock";
import { AnthropicTransport, LlmAIService, OpenAITransport } from "@/server/ai/providers/llm";

let override: AIService | null = null;

/** Tests inject alternative providers (hostile, failing, malformed) here. */
export function setAIServiceOverride(service: AIService | null) {
  override = service;
}

export function getAIService(): AIService {
  if (override) return override;
  const e = env();
  switch (e.AI_PROVIDER) {
    case "mock":
      return new MockAIService();
    case "unavailable":
      return new UnavailableAIService();
    case "anthropic":
      return new LlmAIService(new AnthropicTransport(e.AI_MODEL ?? "claude-sonnet-5-5", e.ANTHROPIC_API_KEY!));
    case "openai":
      if (!e.AI_MODEL) throw new Error("AI_MODEL is required when AI_PROVIDER=openai");
      return new LlmAIService(new OpenAITransport(e.AI_MODEL, e.OPENAI_API_KEY!, e.OPENAI_BASE_URL));
  }
}

/** Safe description for the settings page. Never includes keys. */
export function describeAIConfig() {
  const e = env();
  return {
    provider: e.AI_PROVIDER,
    model: e.AI_PROVIDER === "mock" ? "relayops-mock-1" : e.AI_PROVIDER === "unavailable" ? "none" : (e.AI_MODEL ?? (e.AI_PROVIDER === "anthropic" ? "claude-sonnet-5-5" : "not set")),
    timeoutMs: e.AI_TIMEOUT_MS,
    maxRetries: e.AI_MAX_RETRIES,
    maxInputChars: e.AI_MAX_INPUT_CHARS,
    runsPerHour: e.AI_RUNS_PER_HOUR,
    keyConfigured: e.AI_PROVIDER === "anthropic" ? Boolean(e.ANTHROPIC_API_KEY) : e.AI_PROVIDER === "openai" ? Boolean(e.OPENAI_API_KEY) : null,
  };
}
