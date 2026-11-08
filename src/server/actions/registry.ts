import { z } from "zod";
import { ACTION_META, ACTION_TYPES, MANUAL_REQUEST_STATUSES, SERVICE_TYPES, type ActionType, type RiskLevel } from "@/lib/domain";

/**
 * The complete, fixed set of actions RelayOps can perform. Each action has a
 * strict parameter schema: unknown fields, unknown action types and malformed
 * identifiers are rejected. Nothing outside this registry can be executed.
 */

const text = (max: number) => z.string().trim().min(1).max(max);

export const actionParamSchemas = {
  draft_customer_response: z.strictObject({
    to_email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    subject: text(200),
    body: text(4000),
  }),
  update_request_status: z.strictObject({
    status: z.enum(MANUAL_REQUEST_STATUSES),
    reason: text(500),
  }),
  assign_team_member: z.strictObject({
    assignee_user_id: z.uuid(),
  }),
  add_internal_note: z.strictObject({
    body: text(2000),
  }),
  create_service_request: z.strictObject({
    customer_id: z.uuid(),
    bike_description: text(200),
    issue_summary: text(1000),
    service_type: z.enum(SERVICE_TYPES),
  }),
  propose_appointment: z.strictObject({
    appointment_slot_id: z.uuid(),
    customer_id: z.uuid(),
    service_type: z.enum(SERVICE_TYPES),
    notes: z.string().trim().max(500).optional(),
  }),
  prepare_refund_request: z.strictObject({
    order_id: z.uuid(),
    customer_id: z.uuid(),
    amount_cents: z.number().int().positive().max(5_000_000),
    reason: text(1000),
  }),
} satisfies Record<ActionType, z.ZodType>;

export type ActionParams<T extends ActionType> = z.output<(typeof actionParamSchemas)[T]>;
export type AnyActionParams = { [K in ActionType]: ActionParams<K> }[ActionType];

export const actionTypeSchema = z.enum(ACTION_TYPES);

export function isActionType(value: unknown): value is ActionType {
  return actionTypeSchema.safeParse(value).success;
}

/** Risk of executing an action. Defined here in code, never by the model. */
export function riskFor(type: ActionType): RiskLevel {
  return ACTION_META[type].risk;
}

export type ParseResult =
  | { ok: true; actionType: ActionType; params: AnyActionParams }
  | { ok: false; reason: "unknown_action_type" | "invalid_params"; issues: string[] };

export function parseAction(actionType: unknown, params: unknown): ParseResult {
  const t = actionTypeSchema.safeParse(actionType);
  if (!t.success) {
    return { ok: false, reason: "unknown_action_type", issues: [`Unsupported action type`] };
  }
  const p = actionParamSchemas[t.data].safeParse(params);
  if (!p.success) {
    return {
      ok: false,
      reason: "invalid_params",
      issues: p.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "params"}: ${i.message}`),
    };
  }
  return { ok: true, actionType: t.data, params: stripUndefined(p.data) as AnyActionParams };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Actions the AI may suggest in a proposal list. Customer responses are
 * drafted through the separate drafting step, and the server fills in the
 * recipient itself.
 */
export const AI_PROPOSABLE_ACTIONS: ActionType[] = [
  "update_request_status",
  "assign_team_member",
  "add_internal_note",
  "create_service_request",
  "propose_appointment",
  "prepare_refund_request",
];

/** Human-readable descriptions given to the model alongside the JSON schemas. */
export const ACTION_DESCRIPTIONS: Record<ActionType, string> = {
  draft_customer_response: "Reply to the customer. Created by the drafting step; do not propose it.",
  update_request_status: "Change the request status to needs_review, completed or rejected (for spam/abuse).",
  assign_team_member: "Assign the request to a team member listed in team_members.",
  add_internal_note: "Leave a short note for staff.",
  create_service_request: "Open a service ticket for the customer's bike. Requires a known customer_id from evidence.",
  propose_appointment: "Book one available appointment slot from evidence. Requires slot id and customer id from evidence.",
  prepare_refund_request: "Prepare a refund request for a manager. Only for an order in evidence whose return_eligibility is 'eligible'.",
};
