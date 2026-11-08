import { ACTION_META, type ActionType } from "@/lib/domain";

type EventLike = { event_type: string; actor_type: string; actor_name: string | null; result: string; metadata: Record<string, unknown> };

const actionLabel = (t: unknown) => (typeof t === "string" && t in ACTION_META ? ACTION_META[t as ActionType].label.toLowerCase() : String(t ?? "action").replace(/_/g, " "));

/** Plain-language description of an audit event for timelines and logs. */
export function describeEvent(e: EventLike): string {
  const m = e.metadata ?? {};
  const who = e.actor_type === "ai" ? "AI" : e.actor_type === "system" ? "RelayOps" : e.actor_type === "public" ? "Public form" : (e.actor_name ?? "Someone");
  switch (e.event_type) {
    case "auth.signed_in":
      return `${who} signed in`;
    case "request.created":
      return `Request received via ${String(m.channel ?? "intake").replace(/_/g, " ")}${m.matched_customer ? ", matched to a customer record" : ", sender not matched to a customer"}`;
    case "request.status_changed":
      return `Status changed from ${String(m.from).replace(/_/g, " ")} to ${String(m.to).replace(/_/g, " ")}`;
    case "request.assigned":
      return m.via_rule ? `Assigned by rule "${m.rule_name}"` : `${who} assigned the request`;
    case "request.priority_set":
      return `Priority set to ${m.priority} by rule "${m.rule_name}"`;
    case "request.flagged_unresolved":
      return `Flagged as unresolved after ${m.after_hours} hours`;
    case "request.review_required":
      return `Human review required by rule "${m.rule_name}"`;
    case "ai.processing_started":
      return `AI processing started (${m.provider}, ${m.model})`;
    case "ai.processing_completed":
      return `AI processing finished: ${m.category ? `classified as ${String(m.category).replace(/_/g, " ")}, ` : ""}${m.proposals_created} proposal(s)${Number(m.proposals_blocked) ? `, ${m.proposals_blocked} refused` : ""}`;
    case "ai.processing_failed":
      return `AI processing failed (${m.error_code}); manual workflow remains available`;
    case "ai.output_rejected":
      return `AI suggestion for ${actionLabel(m.attempted_action)} was refused: ${m.reason}`;
    case "proposal.blocked_by_policy":
      return `AI attempted an unsupported action "${m.attempted_action}"; blocked by policy`;
    case "classification.corrected":
      return `${who} corrected the classification${m.from_category !== m.to_category ? ` to ${String(m.to_category).replace(/_/g, " ")}` : ""}`;
    case "retrieval.completed":
      return `Retrieved ${m.records} business record(s)`;
    case "proposal.created":
      return `${e.actor_type === "ai" ? "AI proposed" : e.actor_type === "system" ? "Rule proposed" : `${who} proposed`}: ${actionLabel(m.action_type)}${m.requires_approval ? " (approval required)" : ""}`;
    case "proposal.edited":
      return `${who} edited the proposal (v${m.from_version} to v${m.to_version})`;
    case "proposal.submitted":
      return `${who} sent ${actionLabel(m.action_type)} for approval`;
    case "proposal.cancelled":
      return `${who} dismissed ${actionLabel(m.action_type)}`;
    case "approval.granted":
      return `${who} approved ${actionLabel(m.action_type)} (v${m.version})`;
    case "approval.rejected":
      return `${who} rejected ${actionLabel(m.action_type)}`;
    case "approval.invalidated":
      return "Earlier approval invalidated because the parameters changed";
    case "action.execution_started":
      return `${who} started executing ${actionLabel(m.action_type)}`;
    case "action.executed":
      return `Executed ${actionLabel(m.action_type)}: ${m.summary ?? "done"}`;
    case "action.execution_failed":
      return `Execution of ${actionLabel(m.action_type)} failed: ${m.reason}`;
    case "action.execution_denied":
      return `Execution refused: ${m.reason}`;
    case "delivery.simulated":
      return "Message recorded by the simulated delivery adapter (not sent)";
    case "rule.created":
      return `${who} created rule "${m.name}"`;
    case "rule.updated":
      return `${who} updated rule "${m.name}"${m.enabled === false ? " (disabled)" : ""}`;
    case "rule.deleted":
      return `${who} deleted rule "${m.name}"`;
    case "rule.applied":
      return `Rule "${m.rule_name}" applied (${String(m.effect).replace(/_/g, " ")})`;
    case "team.member_added":
      return `${who} added a team member (${m.role})`;
    case "team.member_updated":
      return `${who} changed a membership (${m.from_role}/${m.from_status} to ${m.to_role}/${m.to_status})`;
    case "settings.updated":
      return `${who} updated business settings`;
    case "category.updated":
      return `${who} updated category "${m.label}"`;
    case "integration.key_created":
      return `${who} created intake API key "${m.name}"`;
    case "integration.key_revoked":
      return `${who} revoked an intake API key`;
    case "record.updated":
      return `${who} updated a ${String(m.field ?? "record").replace(/_/g, " ")}`;
    default:
      return e.event_type.replace(/[._]/g, " ");
  }
}
