import "server-only";
import { withConnection } from "@/server/db/pool";
import { AppError } from "@/server/errors";

export type RateLimitResult = { allowed: boolean; hits: number; resetAt: Date };

/**
 * Fixed-window limiter backed by Postgres so limits hold across serverless
 * instances. Keys must not contain raw personal data; callers pass hashes.
 */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  return withConnection(async (tx) => {
    const row = await tx.one<{ allowed: boolean; hits: number; reset_at: Date }>(
      "select * from app.rate_limit_hit($1, $2, $3)",
      [key, limit, windowSeconds],
    );
    return { allowed: row.allowed, hits: row.hits, resetAt: row.reset_at };
  });
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number, message: string) {
  const result = await hitRateLimit(key, limit, windowSeconds);
  if (!result.allowed) {
    throw new AppError("rate_limited", message);
  }
  return result;
}
