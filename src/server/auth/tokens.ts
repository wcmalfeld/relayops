import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/server/env";

/** Random bearer secret, URL-safe. */
export function newSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Keyed hash used for session tokens, API keys and IP addresses. Only hashes
 * are stored, so a database leak does not reveal usable credentials.
 */
export function secretHash(value: string, purpose: "session" | "api_key" | "ip") {
  return createHmac("sha256", env().AUTH_SECRET).update(`${purpose}:${value}`).digest("hex");
}
