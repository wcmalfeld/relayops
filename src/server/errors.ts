import { ZodError } from "zod";

export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "internal";

const HTTP_STATUS: Record<AppErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
};

/**
 * An error whose message is safe to show to the user. Anything that is not an
 * AppError is reported as a generic failure so internals never leak.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: Record<string, string>;

  constructor(code: AppErrorCode, message: string, details?: Record<string, string>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get status() {
    return HTTP_STATUS[this.code];
  }
}

export const forbidden = (message = "You do not have permission to do that.") => new AppError("forbidden", message);
export const notFound = (message = "Not found.") => new AppError("not_found", message);
export const conflict = (message: string) => new AppError("conflict", message);
export const invalid = (message: string, details?: Record<string, string>) => new AppError("validation", message, details);

type PgError = { code?: string; message?: string; constraint?: string };

/** Translate Postgres errors raised by RLS, triggers and constraints. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return new AppError("validation", first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Invalid input.");
  }
  const pg = err as PgError;
  switch (pg?.code) {
    case "42501": // insufficient_privilege, including RLS WITH CHECK violations
      return new AppError("forbidden", "That operation is not permitted.");
    case "23514": // check_violation (also raised by our guard triggers)
      return new AppError("conflict", cleanTriggerMessage(pg.message) ?? "That change is not allowed in the current state.");
    case "23505":
      return new AppError("conflict", "That record already exists or was already processed.");
    case "23503":
      return new AppError("validation", "A referenced record does not exist in this business.");
    case "22P02":
      return new AppError("validation", "An identifier was malformed.");
    default:
      return new AppError("internal", "Something went wrong. The error has been recorded.");
  }
}

function cleanTriggerMessage(message?: string) {
  if (!message) return undefined;
  // Trigger messages are authored by us and contain no sensitive data.
  if (/^(proposal|approval|execution|only|no valid|invalid proposal|new proposals)/i.test(message)) {
    return message.charAt(0).toUpperCase() + message.slice(1) + ".";
  }
  return undefined;
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code: AppErrorCode; fieldErrors?: Record<string, string> };

/** Wrap a server action body so failures become safe, typed results. */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (err) {
    // Next.js uses thrown errors for redirect()/notFound(); let them through.
    if (isNextControlFlow(err)) throw err;
    const appErr = toAppError(err);
    if (appErr.code === "internal") {
      console.error("[relayops] action failed", errorSummary(err));
    }
    return { ok: false, error: appErr.message, code: appErr.code, fieldErrors: appErr.details };
  }
}

export function isNextControlFlow(err: unknown) {
  const digest = (err as { digest?: unknown })?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

/** Log-safe summary of an error: no parameters, no row data. */
export function errorSummary(err: unknown) {
  const e = err as PgError & { name?: string; stack?: string };
  return { name: e?.name, code: e?.code, message: e?.message?.slice(0, 300), constraint: e?.constraint };
}
