"use server";

import { revalidatePath } from "next/cache";
import { requireActionUser } from "@/server/auth/context";
import { runAction } from "@/server/errors";
import { cancelProposal, createManualProposal, decideProposal, editProposal, submitProposal } from "@/server/actions/proposals";
import { executeProposal } from "@/server/actions/execute";

function refresh(requestId?: string) {
  revalidatePath("/requests");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  revalidatePath("/records");
  if (requestId) revalidatePath(`/requests/${requestId}`);
}

export async function editProposalAction(requestId: string, proposalId: string, params: unknown, expectedVersion: number) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    const result = await editProposal(ctx, proposalId, { params, expectedVersion });
    refresh(requestId);
    return result;
  }, "Changes saved. Any earlier approval no longer applies.");
}

export async function submitProposalAction(requestId: string, proposalId: string, expectedVersion: number) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await submitProposal(ctx, proposalId, expectedVersion);
    refresh(requestId);
  }, "Sent for approval.");
}

export async function decideProposalAction(
  requestId: string,
  proposalId: string,
  input: { decision: "approved" | "rejected"; expectedVersion: number; expectedParamsHash: string; comment?: string },
  executeAfterApproval: boolean,
) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await decideProposal(ctx, proposalId, input);
    let execution: Awaited<ReturnType<typeof executeProposal>> | null = null;
    if (input.decision === "approved" && executeAfterApproval) {
      execution = await executeProposal(ctx, proposalId, input.expectedVersion);
    }
    refresh(requestId);
    return { execution };
  });
}

export async function executeProposalAction(requestId: string, proposalId: string, expectedVersion: number) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    const outcome = await executeProposal(ctx, proposalId, expectedVersion);
    refresh(requestId);
    return outcome;
  });
}

export async function cancelProposalAction(requestId: string, proposalId: string, reason: string) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    await cancelProposal(ctx, proposalId, reason);
    refresh(requestId);
  }, "Proposal dismissed.");
}

/**
 * Staff-initiated action. It goes through the same proposal pipeline as AI
 * suggestions: validated, risk-rated, and executed immediately only when the
 * policy does not require approval.
 */
export async function staffActionAction(requestId: string, actionType: string, params: unknown, explanation: string, executeIfAllowed: boolean) {
  return runAction(async () => {
    const ctx = await requireActionUser();
    const proposal = await createManualProposal(ctx, { requestId, actionType, params, explanation });
    let execution: Awaited<ReturnType<typeof executeProposal>> | null = null;
    if (executeIfAllowed && !proposal.requires_approval) {
      execution = await executeProposal(ctx, proposal.id, proposal.version);
    }
    refresh(requestId);
    return { proposalId: proposal.id, requiresApproval: proposal.requires_approval, execution };
  });
}
