import "server-only";
import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url({ message: "DATABASE_URL must be a postgres connection URL" }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    APP_URL: z.url().default("http://localhost:3000"),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),

    AI_PROVIDER: z.enum(["mock", "anthropic", "openai", "unavailable"]).default("mock"),
    AI_MODEL: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_BASE_URL: z.url().default("https://api.openai.com/v1"),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(25_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_MAX_INPUT_CHARS: z.coerce.number().int().min(500).max(20_000).default(6000),
    AI_RUNS_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(120),
    AI_LOG_PROMPTS: booleanFromString.default(false),

    DELIVERY_PROVIDER: z.enum(["mock"]).default("mock"),
    PUBLIC_INTAKE_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(10),
    API_INTAKE_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(60),
    LOGIN_ATTEMPTS_PER_15_MIN: z.coerce.number().int().min(1).max(1000).default(10),
    /** Bearer secret for the scheduled unresolved-request check. Unset disables the route. */
    CRON_SECRET: z.string().min(24).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["ANTHROPIC_API_KEY"], message: "required when AI_PROVIDER=anthropic" });
    }
    if (env.AI_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["OPENAI_API_KEY"], message: "required when AI_PROVIDER=openai" });
    }
    if (env.NODE_ENV === "production" && /change-me|dev-only/i.test(env.AUTH_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: "replace the development AUTH_SECRET in production" });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Validated server environment. Parsed lazily so `next build` does not need
 * runtime secrets; the first request fails fast with a readable message if
 * configuration is wrong.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached environment after mutating process.env. */
export function resetEnvCache() {
  cached = null;
}

export function isSecureAppUrl() {
  return env().APP_URL.startsWith("https://");
}
