"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, FileText, History, Lock, Play, Send, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/input";
import { OriginBadge, ProposalStatusBadge, RiskBadge, SimulatedBadge } from "@/components/app/badges";
import { ParamsFields, PARAM_LABELS, cleanParams, formatParam, type ActionOptions, type Params } from "@/components/app/action-forms";
import { useAction } from "@/components/app/use-action";
import { cancelProposalAction, decideProposalAction, editProposalAction, executeProposalAction, submitProposalAction } from "@/app/actions/proposals";
import { ACTION_META, type ActionType, type ProposalStatus, type RiskLevel } from "@/lib/domain";
import { cn, formatDateTime } from "@/lib/utils";

export type ProposalCardData = {
  id: string;
  request_id: string;
  action_type: ActionType;
  params: Params;
  original_params: Params;
  params_hash: string;
  version: number;
  explanation: string;
  evidence_refs: string[];
  unresolved_requirements: string[];
  claims: { text: string; basis: "record" | "customer" | "assumption" | "unavailable"; evidence_refs: string[] }[];
  risk_level: RiskLevel;
  requires_approval: boolean;
  status: ProposalStatus;
  origin: "ai" | "user" | "rule";
  created_at: string;
  created_by_name: string | null;
  submitted_by_name: string | null;
  executed_by_name: string | null;
  executed_at: string | null;
  execution_result: Record<string, unknown> | null;
  failure_reason: string | null;
  cancel_reason: string | null;
  approvals: { id: string; decision: string; decided_by_name: string; proposal_version: number; params_hash: string; comment: string | null; created_at: string; invalidated_at: string | null }[];
  revision_count: number;
};

export type Permissions = { canEdit: boolean; canSubmit: boolean; canDecide: boolean; canExecuteApproved: boolean; canExecuteMedium: boolean; canCancel: boolean };

type Props = {
  proposal: ProposalCardData;
  paramLabels: Record<string, string>;
  evidenceLabels: Record<string, string>;
  customerName: string;
  perms: Permissions;
  options: ActionOptions;
  context?: { reference: string; subject: string };
};

const OPEN: ProposalStatus[] = ["draft", "pending_approval", "approved", "failed"];

export function ProposalCard({ proposal: p, paramLabels, evidenceLabels, customerName, perms, options, context }: Props) {
  const meta = ACTION_META[p.action_type];
  const open = OPEN.includes(p.status);
  const edited = JSON.stringify(p.params) !== JSON.stringify(p.original_params);
  const [showOriginal, setShowOriginal] = useState(false);
  const { pending, run } = useAction();

  const canExecuteNow = p.requires_approval ? perms.canExecuteApproved && (p.status === "approved" || p.status === "failed") : perms.canExecuteMedium && (p.status === "draft" || p.status === "failed");

  return (
    <article
      aria-labelledby={`proposal-${p.id}-title`}
      className={cn("overflow-hidden rounded-lg border bg-surface shadow-raise", p.status === "pending_approval" ? "border-amber/40" : p.status === "failed" ? "border-red/35" : "border-line", !open && "opacity-[0.92]")}
    >
      {/* Slip header */}
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line bg-sunken/50 px-4 py-2.5">
        <FileText aria-hidden className="size-4 text-faint" />
        <h3 id={`proposal-${p.id}-title`} className="mr-auto text-[14px] font-semibold text-ink">
          {meta.label}
        </h3>
        <ProposalStatusBadge status={p.status} />
        <RiskBadge risk={p.risk_level} />
        <OriginBadge origin={p.origin} />
      </header>

      <div className="px-4 py-3">
        {context ? (
          <p className="mb-2 text-[13px] text-muted">
            <Link href={`/requests/${p.request_id}`} className="font-mono text-xs text-accent hover:underline">
              {context.reference}
            </Link>{" "}
            {context.subject}
          </p>
        ) : null}

        <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[9rem_minmax(0,1fr)]">
          <dt className="text-muted">Affects</dt>
          <dd className="text-ink">{customerName}</dd>
          <dt className="text-muted">If executed</dt>
          <dd className="text-ink-2">{meta.effect}</dd>
          <dt className="text-muted">Approval</dt>
          <dd className="text-ink-2">{p.requires_approval ? "Owner approval required before this can run." : "No approval needed; any permitted team member can execute it."}</dd>
        </dl>

        {/* Exact parameters: what will actually be executed. */}
        <div className="mt-3 rounded-md border border-line-strong">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
            <p className="text-xs font-medium text-ink-2">Exact values{p.action_type === "draft_customer_response" ? " (message preview)" : ""}</p>
            <p className="text-2xs text-muted">
              Version {p.version}
              {edited ? ", edited by staff" : ""}
            </p>
          </div>
          <ParamLedger type={p.action_type} params={showOriginal ? p.original_params : p.params} labels={paramLabels} />
          {edited ? (
            <button type="button" onClick={() => setShowOriginal((v) => !v)} className="flex w-full items-center gap-1.5 border-t border-line px-3 py-1.5 text-left text-xs text-accent hover:bg-sunken/50">
              <History className="size-3.5" />
              {showOriginal ? "Show current values" : `Show the original ${p.origin === "ai" ? "AI" : ""} version`}
            </button>
          ) : null}
          <div className="flex items-center gap-1.5 border-t border-line bg-sunken/40 px-3 py-1.5 text-2xs text-muted" title={p.params_hash}>
            <Lock aria-hidden className="size-3" />
            <span>An approval applies only to these values, sealed as</span>
            <code className="font-mono text-ink-2">{p.params_hash.slice(0, 10)}…{p.params_hash.slice(-4)}</code>
          </div>
        </div>

        <div className="mt-3">
          <p className="text-xs font-medium text-ink-2">Why</p>
          <p className="mt-0.5 text-[13px] text-ink-2">{p.explanation}</p>
        </div>

        {p.claims.length ? <ClaimsList claims={p.claims} evidenceLabels={evidenceLabels} /> : null}

        {p.evidence_refs.length ? (
          <div className="mt-3">
            <p className="text-xs font-medium text-ink-2">Evidence</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {p.evidence_refs.map((r) => (
                <li key={r}>
                  <a href={`#evidence-${r.replace(":", "-")}`} className="inline-block rounded-sm border border-line bg-sunken/60 px-1.5 py-px text-xs text-ink-2 hover:border-accent hover:text-accent">
                    {evidenceLabels[r] ?? r}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : p.origin === "ai" && p.action_type !== "add_internal_note" ? (
          <p className="mt-3 text-xs text-muted">No business records were cited for this proposal.</p>
        ) : null}

        {p.unresolved_requirements.length && open ? (
          <div className="mt-3 rounded-md border border-amber/30 bg-amber-soft px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber">
              <AlertTriangle aria-hidden className="size-3.5" /> Check before approving
            </p>
            <ul className="mt-1 list-disc pl-5 text-[13px] text-ink-2">
              {p.unresolved_requirements.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <History_ p={p} tz={options.timezone} />
      </div>

      {open || p.status === "executed" ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
          {perms.canDecide && p.status === "pending_approval" ? <ApprovalDialog p={p} labels={paramLabels} customerName={customerName} /> : null}
          {p.requires_approval && p.status === "draft" && perms.canSubmit ? (
            <Button variant="primary" size="sm" disabled={pending} onClick={() => run(() => submitProposalAction(p.request_id, p.id, p.version))}>
              <Send /> Send for approval
            </Button>
          ) : null}
          {canExecuteNow ? <ExecuteDialog p={p} labels={paramLabels} customerName={customerName} /> : null}
          {perms.canEdit && open ? <EditDialog p={p} options={options} /> : null}
          {perms.canCancel && open ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => cancelProposalAction(p.request_id, p.id, "Dismissed by reviewer"))}>
              <X /> Dismiss
            </Button>
          ) : null}
          {p.status === "pending_approval" && !perms.canDecide ? <span className="text-xs text-muted">Waiting for an owner to approve.</span> : null}
          {p.status === "executed" && p.action_type === "draft_customer_response" ? <SimulatedBadge /> : null}
        </footer>
      ) : null}
    </article>
  );
}

function ParamLedger({ type, params, labels }: { type: ActionType; params: Params; labels: Record<string, string> }) {
  if (type === "draft_customer_response") {
    return (
      <div className="text-[13px]">
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] border-b border-line px-3 py-1.5">
          <span className="text-muted">To</span>
          <span className="break-all text-ink">{String(params.to_email ?? "")}</span>
        </div>
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] border-b border-line px-3 py-1.5">
          <span className="text-muted">Subject</span>
          <span className="text-ink">{String(params.subject ?? "")}</span>
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-sans text-[13px] leading-relaxed text-ink">{String(params.body ?? "")}</pre>
      </div>
    );
  }
  return (
    <dl className="text-[13px]">
      {Object.entries(params).map(([k, v]) => {
        const f = formatParam(k, v, labels);
        return (
          <div key={k} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2 border-b border-line px-3 py-1.5 last:border-0">
            <dt className="text-muted">{PARAM_LABELS[k] ?? k}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words text-ink">
              {f.text}
              {f.id ? <span className="ml-1.5 font-mono text-2xs text-faint">{f.id.slice(0, 8)}</span> : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

const BASIS: Record<string, { title: string; tone: string }> = {
  record: { title: "Confirmed by records", tone: "text-accent-strong" },
  customer: { title: "Supplied by the customer", tone: "text-blue" },
  assumption: { title: "Assumptions", tone: "text-amber" },
  unavailable: { title: "Not available in records", tone: "text-red" },
};

function ClaimsList({ claims, evidenceLabels }: { claims: ProposalCardData["claims"]; evidenceLabels: Record<string, string> }) {
  const groups = (["record", "customer", "assumption", "unavailable"] as const).map((b) => [b, claims.filter((c) => c.basis === b)] as const).filter(([, c]) => c.length);
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-ink-2">What the draft relies on</p>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        {groups.map(([basis, items]) => (
          <div key={basis} className="rounded-md border border-line px-2.5 py-2">
            <p className={cn("text-xs font-medium", BASIS[basis].tone)}>{BASIS[basis].title}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {items.map((c, i) => (
                <li key={i} className="text-xs text-ink-2">
                  {c.text}
                  {basis === "record" && c.evidence_refs.length === 0 ? <span className="ml-1 text-red">(no record cited)</span> : null}
                  {c.evidence_refs.length ? <span className="block text-2xs text-muted">{c.evidence_refs.map((r) => evidenceLabels[r] ?? r).join("; ")}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function History_({ p, tz }: { p: ProposalCardData; tz: string }) {
  const lines: { key: string; text: React.ReactNode; tone?: string }[] = [];
  const by =
    p.origin === "ai"
      ? ` by AI processing${p.created_by_name ? ` (run by ${p.created_by_name})` : ""}`
      : p.origin === "rule"
        ? " by a workflow rule"
        : p.created_by_name
          ? ` by ${p.created_by_name}`
          : "";
  lines.push({ key: "c", text: `Created ${formatDateTime(p.created_at, tz)}${by}` });
  if (p.submitted_by_name) lines.push({ key: "s", text: `Sent for approval by ${p.submitted_by_name}` });
  for (const a of p.approvals) {
    lines.push({
      key: a.id,
      tone: a.invalidated_at ? "text-faint line-through" : a.decision === "approved" ? "text-accent-strong" : "text-ink-2",
      text: `${a.decision === "approved" ? "Approved" : "Rejected"} by ${a.decided_by_name} for version ${a.proposal_version}, ${formatDateTime(a.created_at, tz)}${a.comment ? `: "${a.comment}"` : ""}${a.invalidated_at ? " (no longer valid: values changed)" : ""}`,
    });
  }
  if (p.executed_at) lines.push({ key: "e", tone: "text-accent-strong", text: `Executed ${formatDateTime(p.executed_at, tz)} by ${p.executed_by_name ?? "a team member"}: ${String(p.execution_result?.summary ?? "")}` });
  if (p.failure_reason && p.status === "failed") lines.push({ key: "f", tone: "text-red", text: `Execution failed: ${p.failure_reason}` });
  if (p.cancel_reason && p.status === "cancelled") lines.push({ key: "x", text: `Dismissed: ${p.cancel_reason}` });
  if (p.revision_count > 1) lines.push({ key: "r", text: `${p.revision_count} versions recorded` });
  return (
    <ul className="mt-3 flex flex-col gap-0.5 border-t border-dashed border-line pt-2">
      {lines.map((l) => (
        <li key={l.key} className={cn("text-xs text-muted", l.tone)}>
          {l.text}
        </li>
      ))}
    </ul>
  );
}

function ConfirmSummary({ p, labels, customerName }: { p: ProposalCardData; labels: Record<string, string>; customerName: string }) {
  const meta = ACTION_META[p.action_type];
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-line bg-sunken/50 px-3 py-2 text-[13px]">
        <p>
          <span className="font-medium text-ink">{meta.label}</span> for <span className="font-medium text-ink">{customerName}</span>
        </p>
        <p className="mt-0.5 text-ink-2">{meta.effect}</p>
        {meta.simulated ? <p className="mt-1 text-xs text-violet">Delivery is simulated. No email leaves RelayOps.</p> : null}
      </div>
      <div className="rounded-md border border-line-strong">
        <ParamLedger type={p.action_type} params={p.params} labels={labels} />
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Lock className="size-3.5" /> Version {p.version}, values sealed as <code className="font-mono text-ink-2">{p.params_hash.slice(0, 16)}</code>
      </p>
    </div>
  );
}

function ApprovalDialog({ p, labels, customerName }: { p: ProposalCardData; labels: Record<string, string>; customerName: string }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [executeNow, setExecuteNow] = useState(true);
  const { pending, run } = useAction();

  const decide = (decision: "approved" | "rejected") =>
    run(
      () =>
        decideProposalAction(p.request_id, p.id, { decision, expectedVersion: p.version, expectedParamsHash: p.params_hash, comment: comment || undefined }, decision === "approved" && executeNow),
      {
        success: (d) => {
          if (decision === "rejected") return "Proposal rejected.";
          if (!d.execution) return "Approved. It can now be executed.";
          return d.execution.status === "executed" ? `Approved and executed. ${d.execution.summary}` : null;
        },
        onSuccess: (d) => {
          if (d.execution?.status === "failed") toast.error(`Approved, but execution failed: ${d.execution.reason}`);
          setOpen(false);
        },
      },
    );

  return (
    <>
      <Button variant="approve" size="sm" onClick={() => setOpen(true)}>
        <BadgeCheck /> Review and decide
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Approve this action?" description="Check the exact values. Approving covers only this version." wide>
          <ConfirmSummary p={p} labels={labels} customerName={customerName} />
          {p.unresolved_requirements.length ? (
            <div className="mt-3 rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-[13px] text-ink-2">
              <p className="font-medium text-amber">Open questions flagged on this proposal</p>
              <ul className="mt-1 list-disc pl-5">
                {p.unresolved_requirements.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-4 flex flex-col gap-1.5">
            <Label htmlFor={`comment-${p.id}`}>Comment (optional)</Label>
            <Textarea id={`comment-${p.id}`} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} className="min-h-16" />
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={executeNow} onChange={(e) => setExecuteNow(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
            Execute immediately after approving
          </label>
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button variant="danger" disabled={pending} onClick={() => decide("rejected")}>
              Reject
            </Button>
            <Button variant="approve" disabled={pending} onClick={() => decide("approved")}>
              <BadgeCheck />
              {pending ? "Working…" : executeNow ? "Approve and execute" : "Approve"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExecuteDialog({ p, labels, customerName }: { p: ProposalCardData; labels: Record<string, string>; customerName: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const label = p.status === "failed" ? "Retry execution" : "Execute";
  return (
    <>
      <Button variant={p.requires_approval ? "approve" : "primary"} size="sm" onClick={() => setOpen(true)}>
        <Play /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`${label}: ${ACTION_META[p.action_type].label}`} description="This runs exactly the values below." wide>
          <ConfirmSummary p={p} labels={labels} customerName={customerName} />
          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                run(() => executeProposalAction(p.request_id, p.id, p.version), {
                  success: (d) => (d.status === "executed" ? d.summary : null),
                  onSuccess: (d) => {
                    if (d.status === "failed") toast.error(`Execution failed: ${d.reason}`);
                    setOpen(false);
                  },
                })
              }
            >
              <Play /> {pending ? "Executing…" : label}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditDialog({ p, options }: { p: ProposalCardData; options: ActionOptions }) {
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<Params>(p.params);
  const [errors, setErrors] = useState<Record<string, string>>();
  const { pending, run } = useAction();
  const hadApproval = p.status === "approved" || p.status === "pending_approval";
  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setParams(p.params);
          setErrors(undefined);
          setOpen(true);
        }}
      >
        <Pencil /> Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Edit: ${ACTION_META[p.action_type].label}`} description="Your edit is saved as a new version. The original stays in the history." wide>
          {hadApproval ? (
            <p className="mb-3 rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-[13px] text-ink-2">
              Saving changes returns this proposal to draft. {p.status === "approved" ? "The existing approval will no longer apply." : "It will need to be sent for approval again."}
            </p>
          ) : null}
          <ParamsFields type={p.action_type} value={params} onChange={setParams} options={options} idPrefix={`edit-${p.id}`} errors={errors} />
          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                run(() => editProposalAction(p.request_id, p.id, cleanParams(p.action_type, params), p.version), {
                  success: (d) => (d.changed ? "Saved as a new version." : "No changes to save."),
                  onSuccess: () => setOpen(false),
                  onError: (r) => setErrors(r.fieldErrors),
                })
              }
            >
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

