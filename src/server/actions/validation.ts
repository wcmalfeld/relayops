import "server-only";
import type { Tx } from "@/server/db/pool";
import { AppError, notFound } from "@/server/errors";
import type { BusinessRecord } from "@/server/settings/business";
import { returnEligibility } from "@/server/records/policy-rules";
import { canTransitionManually } from "@/server/requests/status";
import type { ActionType, RequestStatus } from "@/lib/domain";
import type { AnyActionParams, ActionParams } from "@/server/actions/registry";

export type RequestForAction = {
  id: string;
  status: RequestStatus;
  category: string | null;
  customer_id: string | null;
  customer_email: string | null;
  customer_record_email: string | null;
  assigned_to: string | null;
};

export async function loadRequestForAction(tx: Tx, requestId: string, lock = false): Promise<RequestForAction> {
  const row = await tx.maybeOne<RequestForAction>(
    `select r.id, r.status, r.category, r.customer_id, r.customer_email, r.assigned_to,
            c.email as customer_record_email
       from customer_requests r left join customers c on c.id = r.customer_id
      where r.id = $1
      ${lock ? "for update of r" : ""}`,
    [requestId],
  );
  if (!row) throw notFound("Request not found.");
  return row;
}

const reject = (message: string) => new AppError("validation", message);

/**
 * Business-rule validation for an action against current records. Runs when
 * a proposal is created or edited and again, inside the execution
 * transaction, immediately before the action is performed.
 */
export async function validateActionContext(
  tx: Tx,
  business: BusinessRecord,
  req: RequestForAction,
  actionType: ActionType,
  params: AnyActionParams,
  phase: "propose" | "execute",
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];

  const requireCustomer = (customerId: string) => {
    if (!req.customer_id) {
      throw reject("This request is not linked to a customer record, so customer records cannot be changed from it.");
    }
    if (customerId !== req.customer_id) {
      throw reject("The action targets a different customer than the one who sent this request.");
    }
  };

  switch (actionType) {
    case "draft_customer_response": {
      const p = params as ActionParams<"draft_customer_response">;
      // Responses can only go to the requester. This blocks attempts (for
      // example via prompt injection) to send business data elsewhere.
      const allowed = [req.customer_email, req.customer_record_email].filter(Boolean).map((e) => e!.toLowerCase());
      if (allowed.length === 0) {
        throw reject("This request has no customer email address, so no response can be sent.");
      }
      if (!allowed.includes(p.to_email)) {
        throw reject("Responses can only be sent to the email address of the customer who made this request.");
      }
      break;
    }
    case "update_request_status": {
      const p = params as ActionParams<"update_request_status">;
      if (phase === "execute" && !canTransitionManually(req.status, p.status) && req.status !== p.status) {
        throw reject(`A request in status "${req.status}" cannot be moved to "${p.status}".`);
      }
      break;
    }
    case "assign_team_member": {
      const p = params as ActionParams<"assign_team_member">;
      const member = await tx.maybeOne(
        `select 1 from business_memberships m join profiles pr on pr.id = m.user_id
          where m.user_id = $1 and m.business_id = $2 and m.status = 'active' and pr.is_active`,
        [p.assignee_user_id, business.id],
      );
      if (!member) throw reject("The selected person is not an active member of this business.");
      break;
    }
    case "add_internal_note":
      break;
    case "create_service_request": {
      const p = params as ActionParams<"create_service_request">;
      requireCustomer(p.customer_id);
      break;
    }
    case "propose_appointment": {
      const p = params as ActionParams<"propose_appointment">;
      requireCustomer(p.customer_id);
      const slot = await tx.maybeOne<{ status: string; starts_at: Date; service_type: string }>(
        "select status, starts_at, service_type from appointments where id = $1",
        [p.appointment_slot_id],
      );
      if (!slot) throw reject("That appointment slot does not exist.");
      if (slot.status !== "available") throw reject("That appointment slot is no longer available.");
      if (new Date(slot.starts_at).getTime() < Date.now()) throw reject("That appointment slot is in the past.");
      if (slot.service_type !== "any" && slot.service_type !== p.service_type) {
        throw reject("That slot is reserved for a different service type.");
      }
      break;
    }
    case "prepare_refund_request": {
      const p = params as ActionParams<"prepare_refund_request">;
      requireCustomer(p.customer_id);
      const order = await tx.maybeOne<{ customer_id: string; total_cents: number; status: string; delivered_at: Date | null; order_number: string }>(
        "select customer_id, total_cents, status, delivered_at, order_number from orders where id = $1",
        [p.order_id],
      );
      if (!order) throw reject("That order does not exist.");
      if (order.customer_id !== req.customer_id) throw reject("That order belongs to a different customer.");
      if (p.amount_cents > order.total_cents) throw reject("The refund amount exceeds the order total.");
      const eligibility = returnEligibility(order, business.settings.return_window_days);
      if (eligibility.status !== "eligible") {
        const why =
          eligibility.status === "outside_window"
            ? `it is outside the ${business.settings.return_window_days}-day return window`
            : eligibility.status === "not_delivered"
              ? "it has not been delivered yet"
              : "it was cancelled";
        throw reject(`Order ${order.order_number} is not eligible for a refund request because ${why}. Handle exceptions with a manager outside RelayOps.`);
      }
      const existing = await tx.maybeOne(
        "select 1 from refund_requests where order_id = $1 and status = 'pending_manual_review'",
        [p.order_id],
      );
      if (existing) throw reject("A refund request for this order is already waiting for manual review.");
      break;
    }
  }
  return { warnings };
}
