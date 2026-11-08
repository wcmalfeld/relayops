import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isSecureAppUrl } from "@/server/env";
import { AppError } from "@/server/errors";
import { buildUserContext, resolveSession } from "@/server/auth/session-service";
import type { UserContext } from "@/server/auth/types";

export function sessionCookieName() {
  // The __Host- prefix forces Secure, Path=/ and no Domain when served over HTTPS.
  return isSecureAppUrl() ? "__Host-relayops_session" : "relayops_session";
}

export async function readSessionToken() {
  return (await cookies()).get(sessionCookieName())?.value ?? null;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isSecureAppUrl(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(sessionCookieName());
}

export async function requestMeta() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: forwarded || h.get("x-real-ip") || null, userAgent: h.get("user-agent") };
}

/** The signed-in user's context for this request, or null. Memoized per request. */
export const getUserContext = cache(async (): Promise<UserContext | null> => {
  const session = await resolveSession(await readSessionToken());
  if (!session) return null;
  return buildUserContext(session.userId, session.activeBusinessId);
});

/** For pages: redirect to sign-in when there is no valid session. */
export async function requireUser(): Promise<UserContext> {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For server actions and route handlers: fail closed with a typed error. */
export async function requireActionUser(): Promise<UserContext> {
  const ctx = await getUserContext();
  if (!ctx) throw new AppError("unauthenticated", "Your session has expired. Sign in again.");
  return ctx;
}
