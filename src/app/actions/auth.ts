"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, readSessionToken, requestMeta, setSessionCookie } from "@/server/auth/context";
import { login, logout, switchActiveBusiness } from "@/server/auth/session-service";
import { runAction, toAppError, type ActionResult } from "@/server/errors";

export async function loginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const meta = await requestMeta();
    const { token, expiresAt } = await login({ email: formData.get("email"), password: formData.get("password") }, meta);
    await setSessionCookie(token, expiresAt);
  } catch (err) {
    const e = toAppError(err);
    return { ok: false, error: e.code === "internal" ? "Sign-in is unavailable right now." : e.message, code: e.code };
  }
  redirect("/dashboard");
}

export async function logoutAction() {
  await logout(await readSessionToken());
  await clearSessionCookie();
  redirect("/login");
}

export async function switchBusinessAction(businessId: string) {
  const result = await runAction(async () => {
    const token = await readSessionToken();
    if (!token) throw new Error("No session");
    await switchActiveBusiness(token, businessId);
  });
  if (result.ok) redirect("/dashboard");
  return result;
}
