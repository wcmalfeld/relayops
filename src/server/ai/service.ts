import "server-only";
import type { ClassifyInput, DraftInput, ProposeInput, SummarizeInput } from "@/server/ai/schemas";

export type AITask = "classify" | "summarize" | "draft_response" | "propose_actions";

export type AIUsage = { inputTokens: number | null; outputTokens: number | null };

/** Raw model output plus metadata. `output` is untrusted until validated. */
export type AIResult = { output: unknown; usage: AIUsage; attempts: number };

/**
 * Provider-independent AI interface. Each task has its own method so prompts,
 * schemas and validation stay separate. Business record retrieval is NOT part
 * of this interface: it is deterministic server code (src/server/retrieval).
 */
export interface AIService {
  readonly provider: string;
  readonly model: string;
  classify(input: ClassifyInput): Promise<AIResult>;
  summarize(input: SummarizeInput): Promise<AIResult>;
  draftResponse(input: DraftInput): Promise<AIResult>;
  proposeActions(input: ProposeInput): Promise<AIResult>;
}

export type AIErrorCode = "unavailable" | "timeout" | "rate_limited" | "bad_response" | "configuration";

export class AIError extends Error {
  constructor(
    readonly code: AIErrorCode,
    message: string,
    readonly attempts = 1,
  ) {
    super(message);
    this.name = "AIError";
  }
}

export const PROMPT_VERSION = "2026-10-16.1";
