"use server";

import { revalidatePath } from "next/cache";
import { requireActionUser } from "@/server/auth/context";
import { runAction } from "@/server/errors";
import { createRule, deleteRule, setRuleEnabled, updateRule } from "@/server/rules/service";
import { addTeamMember, createIntakeKey, revokeIntakeKey, updateBusinessSettings, updateCategory, updateTeamMember } from "@/server/team/service";
import { updateInventory, updatePolicy, updateServiceStatus } from "@/server/records/records";

export async function saveRuleAction(ruleId: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    if (ruleId) await updateRule(ctx, ruleId, input);
    else await createRule(ctx, input);
    revalidatePath("/rules");
  }, ruleId ? "Rule saved." : "Rule created.");
}

export async function toggleRuleAction(ruleId: string, enabled: boolean) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await setRuleEnabled(ctx, ruleId, enabled);
    revalidatePath("/rules");
  }, enabled ? "Rule enabled." : "Rule disabled.");
}

export async function deleteRuleAction(ruleId: string) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await deleteRule(ctx, ruleId);
    revalidatePath("/rules");
  }, "Rule deleted.");
}

export async function updateSettingsAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await updateBusinessSettings(ctx, input);
    revalidatePath("/", "layout");
  }, "Settings saved.");
}

export async function updateCategoryAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await updateCategory(ctx, input);
    revalidatePath("/settings");
    revalidatePath("/dashboard");
  }, "Category saved.");
}

export async function addMemberAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await addTeamMember(ctx, input);
    revalidatePath("/settings");
  }, "Team member added.");
}

export async function updateMemberAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await updateTeamMember(ctx, input);
    revalidatePath("/settings");
  }, "Team member updated.");
}

export async function createKeyAction(name: string) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    const key = await createIntakeKey(ctx, name);
    revalidatePath("/settings");
    return key;
  }, "API key created. Copy it now; it will not be shown again.");
}

export async function revokeKeyAction(keyId: string) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await revokeIntakeKey(ctx, keyId);
    revalidatePath("/settings");
  }, "API key revoked.");
}

export async function updateInventoryAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await updateInventory(ctx, input);
    revalidatePath("/records");
  }, "Inventory updated.");
}

export async function updateServiceStatusAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await updateServiceStatus(ctx, input);
    revalidatePath("/records");
  }, "Service ticket updated.");
}

export async function updatePolicyAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await updatePolicy(ctx, input);
    revalidatePath("/records");
  }, "Policy saved.");
}
