// Shared, client-safe vocabulary. Server modules import these constants so the
// UI and the policy code can never disagree about names.

export const REQUEST_STATUSES = [
  "new",
  "processing",
  "needs_review",
  "awaiting_approval",
  "approved",
  "completed",
  "rejected",
  "failed",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  new: "New",
  processing: "Processing",
  needs_review: "Needs Review",
  awaiting_approval: "Awaiting Approval",
  approved: "Approved",
  completed: "Completed",
  rejected: "Rejected",
  failed: "Failed",
};

export const OPEN_REQUEST_STATUSES: RequestStatus[] = ["new", "processing", "needs_review", "awaiting_approval", "approved", "failed"];

export const REQUEST_CHANNELS = ["manual", "demo", "api", "public_form"] as const;
export type RequestChannel = (typeof REQUEST_CHANNELS)[number];
export const CHANNEL_LABELS: Record<RequestChannel, string> = {
  manual: "Manual entry",
  demo: "Demo scenario",
  api: "Intake API",
  public_form: "Public form",
};

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ACTION_TYPES = [
  "draft_customer_response",
  "update_request_status",
  "assign_team_member",
  "add_internal_note",
  "create_service_request",
  "propose_appointment",
  "prepare_refund_request",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export type ActionMeta = {
  label: string;
  /** What executing the action does, in plain words. Shown before approval. */
  effect: string;
  /** Risk of executing the action. Creating any proposal is itself low risk. */
  risk: RiskLevel;
  simulated: boolean;
};

export const ACTION_META: Record<ActionType, ActionMeta> = {
  draft_customer_response: {
    label: "Send customer response",
    effect: "Delivers this exact message to the customer through the simulated delivery adapter. No real email is sent.",
    risk: "high",
    simulated: true,
  },
  update_request_status: {
    label: "Update request status",
    effect: "Changes the status of this request inside RelayOps.",
    risk: "medium",
    simulated: false,
  },
  assign_team_member: {
    label: "Assign team member",
    effect: "Assigns this request to the selected team member.",
    risk: "medium",
    simulated: false,
  },
  add_internal_note: {
    label: "Add internal note",
    effect: "Adds a note visible only to your team.",
    risk: "medium",
    simulated: false,
  },
  create_service_request: {
    label: "Create service ticket",
    effect: "Creates a service ticket in the shop's service queue for this customer.",
    risk: "high",
    simulated: false,
  },
  propose_appointment: {
    label: "Book service appointment",
    effect: "Books the selected appointment slot for this customer. The customer is not notified unless you also send a response.",
    risk: "high",
    simulated: false,
  },
  prepare_refund_request: {
    label: "Prepare refund request",
    effect: "Creates a refund request for a manager to process outside RelayOps. No money moves and no payment system is contacted.",
    risk: "high",
    simulated: false,
  },
};

export const PROPOSAL_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "executing",
  "executed",
  "failed",
  "rejected",
  "cancelled",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  executing: "Executing",
  executed: "Executed",
  failed: "Failed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const SERVICE_TYPES = [
  "tune_up",
  "repair",
  "brake_service",
  "drivetrain",
  "wheel_true",
  "suspension",
  "ebike_diagnostic",
  "fitting",
  "other",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_TYPE_LABELS: Record<ServiceType | "any", string> = {
  tune_up: "Tune-up",
  repair: "General repair",
  brake_service: "Brake service",
  drivetrain: "Drivetrain",
  wheel_true: "Wheel true",
  suspension: "Suspension",
  ebike_diagnostic: "E-bike diagnostic",
  fitting: "Bike fitting",
  other: "Other",
  any: "Any service",
};

/** Statuses a person (or an approved proposal) may set directly. */
export const MANUAL_REQUEST_STATUSES = ["needs_review", "completed", "rejected"] as const;

export const REVIEW_REASON_LABELS: Record<string, string> = {
  ai_unavailable: "AI processing was unavailable; handle manually",
  ai_output_invalid: "AI output failed validation and was discarded",
  possible_prompt_injection: "Message contains instructions aimed at the AI",
  no_supporting_records: "No business records support an answer",
  unsupported_claims: "Draft contains claims not backed by records",
  missing_information: "Customer must supply more information",
  high_uncertainty: "AI interpretation is uncertain",
  customer_not_matched: "Sender does not match a customer record",
  blocked_actions: "AI proposed actions that policy blocks",
  rule: "Required by a workflow rule",
};
