import "server-only";
import { AIError, type AIErrorCode } from "@/server/ai/service";

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/**
 * POST JSON with a per-attempt timeout and bounded retries for transient
 * failures (network errors, timeouts, 429/5xx). Never logs request bodies.
 */
export async function postJsonWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: { timeoutMs: number; maxRetries: number; fetchImpl?: typeof fetch },
): Promise<{ json: unknown; attempts: number }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxAttempts = opts.maxRetries + 1;
  let lastError = new AIError("unavailable", "AI provider unavailable");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as Error)?.name === "AbortError";
      lastError = new AIError(aborted ? "timeout" : "unavailable", aborted ? "AI provider timed out" : "AI provider could not be reached", attempt);
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw lastError;
    }

    try {
      if (res.ok) {
        try {
          return { json: await res.json(), attempts: attempt };
        } catch {
          throw new AIError("bad_response", "AI provider returned invalid JSON", attempt);
        }
      }
      const code: AIErrorCode =
        res.status === 429 ? "rate_limited" : res.status >= 500 ? "unavailable" : res.status === 401 || res.status === 403 ? "configuration" : "bad_response";
      lastError = new AIError(code, `AI provider responded with HTTP ${res.status}`, attempt);
      if (!RETRYABLE.has(res.status) || attempt >= maxAttempts) throw lastError;
      await sleep(backoffMs(attempt, res.headers.get("retry-after")));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function backoffMs(attempt: number, retryAfter: string | null) {
  const hinted = retryAfter ? Number(retryAfter) * 1000 : NaN;
  if (Number.isFinite(hinted) && hinted >= 0) return Math.min(hinted, 5000);
  return Math.min(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200), 5000);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
