import "server-only";
import type { Tx } from "@/server/db/pool";
import type { UserContext } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { deliveryProvider } from "@/server/delivery/delivery";
import { recordAudit } from "@/server/audit/audit";
import { setRequestStatus } from "@/server/requests/status";
import type { BusinessRecord } from "@/server/settings/business";
import type { RequestForAction } from "@/server/actions/validation";
import type { ProposalRow } from "@/server/actions/proposals";
import type { ActionParams } from "@/server/actions/registry";
import type { ActionType } from "@/lib/domain";

export type HandlerResult = {
  summary: string;
  /** Request status already set by the handler; skip derived status sync. */
  statusHandled?: boolean;
  details?: Record<string, unknown>;
};

type Handler = (tx: Tx, ctx: UserContext, p: ProposalRow, req: RequestForAction, business: BusinessRecord) => Promise<HandlerResult>;

/**
 * One handler per supported action. Each performs exactly its own effect,
 * using parameters that were re-validated in the same transaction.
 */
export const handlers: Record<ActionType, Handler> = {
  async draft_customer_response(tx, ctx, p, req) {
    const params = p.params as ActionParams<"draft_customer_response">;
    const provider = deliveryProvider();
    const receipt = await provider.send(tx, {
      businessId: ctx.businessId,
      proposalId: p.id,
      requestId: p.request_id,
      customerId: req.customer_id,
      to: params.to_email,
      subject: params.subject,
      body: params.body,
    });
    await recordAudit(tx, ctx, {
      eventType: "delivery.simulated",
      result: "success",
      requestId: p.request_id,
      entityType: "message_delivery",
      entityId: receipt.deliveryId,
      metadata: { provider: receipt.provider, simulated: receipt.simulated, provider_message_id: receipt.providerMessageId },
    });
    return {
      summary: receipt.simulated
        ? "Message recorded as a simulated delivery. No real email was sent."
        : "Message sent to the customer.",
      details: { delivery_id: receipt.deliveryId, simulated: receipt.simulated, provider: receipt.provider },
    };
  },

  async update_request_status(tx, ctx, p, req) {
    const params = p.params as ActionParams<"update_request_status">;
    await setRequestStatus(tx, ctx, req.id, req.status, params.status, "status_update_action", { proposal_id: p.id });
    return { summary: `Request status changed to ${params.status.replace("_", " ")}.`, statusHandled: true, details: { from: req.status, to: params.status } };
  },

  async assign_team_member(tx, ctx, p, req) {
    const params = p.params as ActionParams<"assign_team_member">;
    await tx.exec("update customer_requests set assigned_to = $2 where id = $1", [req.id, params.assignee_user_id]);
    const who = await tx.maybeOne<{ full_name: string }>("select full_name from profiles where id = $1", [params.assignee_user_id]);
    await recordAudit(tx, ctx, {
      eventType: "request.assigned",
      result: "success",
      requestId: req.id,
      entityType: "customer_request",
      entityId: req.id,
      metadata: { assignee_user_id: params.assignee_user_id, previous_assignee: req.assigned_to, proposal_id: p.id },
    });
    return { summary: `Assigned to ${who?.full_name ?? "team member"}.`, details: { assignee_user_id: params.assignee_user_id } };
  },

  async add_internal_note(tx, ctx, p, req) {
    const params = p.params as ActionParams<"add_internal_note">;
    const note = await tx.one<{ id: string }>(
      "insert into internal_notes (business_id, request_id, body, author_user_id, source_proposal_id) values ($1, $2, $3, $4, $5) returning id",
      [ctx.businessId, req.id, params.body, ctx.userId, p.id],
    );
    return { summary: "Internal note added.", details: { note_id: note.id } };
  },

  async create_service_request(tx, ctx, p, req) {
    const params = p.params as ActionParams<"create_service_request">;
    const sr = await tx.one<{ id: string; ticket_number: string }>(
      `insert into service_requests
         (business_id, customer_id, customer_request_id, bike_description, issue_summary, service_type, status, source_proposal_id, created_by)
       values ($1, $2, $3, $4, $5, $6, 'open', $7, $8) returning id, ticket_number`,
      [ctx.businessId, params.customer_id, req.id, params.bike_description, params.issue_summary, params.service_type, p.id, ctx.userId],
    );
    return { summary: `Service ticket ${sr.ticket_number} created.`, details: { service_request_id: sr.id, ticket_number: sr.ticket_number } };
  },

  async propose_appointment(tx, ctx, p) {
    const params = p.params as ActionParams<"propose_appointment">;
    // Conditional update: only one booking can win the slot, even under concurrency.
    const slot = await tx.maybeOne<{ id: string; starts_at: Date }>(
      `update appointments
          set status = 'booked', customer_id = $2, booked_by_proposal_id = $3, booked_at = now()
        where id = $1 and status = 'available' and starts_at > now()
          and (service_type = 'any' or service_type = $4)
        returning id, starts_at`,
      [params.appointment_slot_id, params.customer_id, p.id, params.service_type],
    );
    if (!slot) {
      throw new AppError("conflict", "The appointment slot is no longer available. Choose another slot and approve again.");
    }
    return {
      summary: "Appointment slot booked. The customer has not been notified by this action.",
      details: { appointment_id: slot.id, starts_at: new Date(slot.starts_at).toISOString() },
    };
  },

  async prepare_refund_request(tx, ctx, p, req) {
    const params = p.params as ActionParams<"prepare_refund_request">;
    const rr = await tx.one<{ id: string }>(
      `insert into refund_requests (business_id, order_id, customer_id, customer_request_id, amount_cents, reason, source_proposal_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [ctx.businessId, params.order_id, params.customer_id, req.id, params.amount_cents, params.reason, p.id, ctx.userId],
    );
    return {
      summary: "Refund request created for manual processing by a manager. No payment was issued.",
      details: { refund_request_id: rr.id, amount_cents: params.amount_cents, money_moved: false },
    };
  },
};
