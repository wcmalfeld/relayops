"use server";

import { revalidatePath } from "next/cache";
import { requireActionUser } from "@/server/auth/context";
import { runAction } from "@/server/errors";
import { AppError } from "@/server/errors";
import { createRequest } from "@/server/intake/intake-service";
import { DEMO_SCENARIOS } from "@/server/intake/demo-scenarios";
import { processRequest } from "@/server/ai/pipeline";
import { correctClassification } from "@/server/requests/classification";
import { runUnresolvedCheck } from "@/server/rules/engine";
import { assertCan } from "@/server/auth/permissions";

function refresh(requestId?: string) {
  revalidatePath("/requests");
  revalidatePath("/dashboard");
  revalidatePath("/approvals");
  if (requestId) revalidatePath(`/requests/${requestId}`);
}

export async function createRequestAction(input: unknown, processNow: boolean) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    const created = await createRequest(ctx, input, "manual");
    let processed: Awaited<ReturnType<typeof processRequest>> | null = null;
    if (processNow && !created.duplicate) processed = await processRequest(ctx, created.id);
    refresh(created.id);
    return { id: created.id, reference: created.reference, processed: processed?.status ?? null };
  }, "Request created.");
}

export async function createDemoRequestAction(scenarioId: string) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    const scenario = DEMO_SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) throw new AppError("validation", "Unknown demo scenario.");
    const created = await createRequest(ctx, scenario.payload, "demo", { isDemo: true });
    refresh(created.id);
    return { id: created.id, reference: created.reference };
  }, "Demo request created.");
}

export async function processRequestAction(requestId: string) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    const outcome = await processRequest(ctx, requestId);
    refresh(requestId);
    return outcome;
  });
}

export async function correctClassificationAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await correctClassification(ctx, input);
    refresh((input as { request_id?: string })?.request_id);
  }, "Classification updated. The original AI output is kept in the history.");
}

export async function runUnresolvedCheckAction() {
  return runAction(async () => {
    const ctx = await requireActionUser();
    assertCan(ctx, "rules.manage");
    const flagged = await runUnresolvedCheck(ctx);
    refresh();
    return { flagged };
  });
}
