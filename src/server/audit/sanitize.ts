/**
 * Audit metadata must stay safe to show to any owner and safe to retain:
 * identifiers, codes, counts and short labels only. Message content, contact
 * details and anything credential-shaped are dropped or redacted.
 */

const MAX_KEYS = 30;
const MAX_STRING = 160;
const MAX_ARRAY = 20;
const MAX_DEPTH = 3;

// Keys whose values are never stored, at any depth.
const BLOCKED_KEY = /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|session|credential|prompt|completion|body|message_text|content|email|phone|address|raw)/i;

// Values that look like credentials even under innocuous keys.
const SECRET_VALUE = [
  /\bsk-[A-Za-z0-9_-]{12,}/, // OpenAI/Anthropic style keys
  /\bsk-ant-[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/i,
  /\bro_live_[A-Za-z0-9_-]{8,}/, // RelayOps intake keys
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWTs
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email addresses
];

export type SafeMetadata = Record<string, unknown>;

export function sanitizeMetadata(input: unknown): SafeMetadata {
  const out = sanitizeValue(input, 0);
  return out && typeof out === "object" && !Array.isArray(out) ? (out as SafeMetadata) : {};
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return sanitizeString(value);
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => sanitizeValue(v, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    let count = 0;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_KEYS) break;
      if (BLOCKED_KEY.test(key)) {
        result[key] = "[redacted]";
      } else {
        result[key] = sanitizeValue(v, depth + 1);
      }
      count++;
    }
    return result;
  }
  return null;
}

function sanitizeString(s: string) {
  if (SECRET_VALUE.some((re) => re.test(s))) return "[redacted]";
  const clean = s.replace(/[\u0000-\u001f\u007f]/g, " ");
  return clean.length > MAX_STRING ? `${clean.slice(0, MAX_STRING)}…` : clean;
}
