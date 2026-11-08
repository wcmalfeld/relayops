import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Bot, ShieldAlert, WifiOff } from "lucide-react";
import { requireUser } from "@/server/auth/context";
import { getRequestDetail, type RequestDetail } from "@/server/requests/queries";
import { can } from "@/server/auth/permissions";
import { AppError } from "@/server/errors";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/app/page-header";
import { Badge, PriorityBadge, RequestStatusBadge, SimulatedBadge, UnresolvedBadge } from "@/components/app/badges";
import { ProposalCard, type ProposalCardData, type Permissions } from "@/components/app/proposal-card";
import type { ActionOptions } from "@/components/app/action-forms";
import { CorrectClassification, NewActionDialog, ProcessButton } from "./request-widgets";
import { CHANNEL_LABELS, REVIEW_REASON_LABELS } from "@/lib/domain";
import { describeEvent } from "@/lib/events";
import { formatDate, formatDateTime, humanize, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Request" };

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export default async function RequestDetailPage({ params }: PageProps<"/requests/[id]">) {
  const ctx = await requireUser();
  const { id } = await params;
  let d: RequestDetail;
  try {
    d = await getRequestDetail(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  }
  const { request: r, business } = d;
  const tz = business.timezone;
  const current = d.classifications.find((c) => c.is_current) ?? null;
  const originalAi = d.classifications.filter((c) => c.source === "ai")[0] ?? null;
  const evidenceLabels = Object.fromEntries(d.evidence.map((e) => [e.ref, e.label]));
  const processable = ["new", "needs_review", "failed"].includes(r.status);
  const openProposals = d.proposals.filter((p) => ["draft", "pending_approval", "approved", "failed"].includes(p.status));
  const closedProposals = d.proposals.filter((p) => !openProposals.includes(p));

  const perms: Permissions = {
    canEdit: can(ctx, "proposals.edit"),
    canSubmit: can(ctx, "proposals.submit"),
    canDecide: can(ctx, "proposals.decide"),
    canExecuteApproved: can(ctx, "proposals.execute_approved"),
    canExecuteMedium: can(ctx, "proposals.execute_medium"),
    canCancel: can(ctx, "proposals.cancel"),
  };
  const options: ActionOptions = plain({
    team: d.team.map((t) => ({ user_id: t.user_id, full_name: t.full_name, title: t.title })),
    slots: d.slots.map((s) => ({ id: s.id, starts_at: s.starts_at as unknown as string, service_type: s.service_type, technician_name: s.technician_name })),
    orders: d.orders,
    customerId: r.customer_id,
    customerEmail: r.customer_email,
    timezone: tz,
  });

  const card = (p: (typeof d.proposals)[number]) => (
    <ProposalCard
      key={p.id}
      proposal={plain({ ...p, request_id: r.id }) as unknown as ProposalCardData}
      paramLabels={d.paramLabels}
      evidenceLabels={evidenceLabels}
      customerName={r.customer_name}
      perms={perms}
      options={options}
    />
  );

  return (
    <>
      <Link href="/requests" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Requests
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">{r.reference}</p>
          <h1 className="text-[22px] font-semibold leading-8 tracking-[-0.01em] text-ink">{r.subject}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <RequestStatusBadge status={r.status} />
            <PriorityBadge priority={r.priority} />
            {r.flagged_unresolved_at && !["completed", "rejected"].includes(r.status) ? <UnresolvedBadge /> : null}
            {r.is_demo ? <Badge tone="violet">Demo data</Badge> : null}
            <span className="text-[13px] text-muted">
              {r.customer_name}, received {formatDateTime(r.received_at, tz)} ({relativeTime(r.received_at)})
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {processable && can(ctx, "requests.process") ? <ProcessButton requestId={r.id} reprocess={r.ai_status !== "not_started"} /> : null}
          {can(ctx, "proposals.create") && !["completed", "rejected"].includes(r.status) ? <NewActionDialog requestId={r.id} options={options} /> : null}
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-2">
        {r.ai_status === "failed" ? (
          <Notice tone="red" icon={<WifiOff />} title="AI processing was unavailable">
            The request is still fully usable. Read the message, look up records in Business records, and use New action to reply, add a note, assign or
            book. Error: {r.ai_error_code ?? "unknown"}.
          </Notice>
        ) : null}
        {current?.injection_suspected ? (
          <Notice tone="amber" icon={<ShieldAlert />} title="This message contains instructions aimed at automated tools">
            Treat it as untrusted. RelayOps refuses unsupported actions and requires approval for anything external, regardless of what the message
            says.
          </Notice>
        ) : null}
        {r.needs_human_review && r.review_reasons.length && !["completed", "rejected"].includes(r.status) ? (
          <Notice tone="amber" icon={<AlertTriangle />} title="Review carefully before acting">
            <ul className="list-disc pl-4">
              {r.review_reasons.map((x) => (
                <li key={x}>{REVIEW_REASON_LABELS[x] ?? humanize(x)}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Left: what was said and how it was read */}
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Original message</CardTitle>
                <CardDescription>Exactly as received. Compare it with the AI&apos;s reading below.</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              <p className="text-[13px] font-medium text-ink">{r.subject}</p>
              <p className="mt-2 max-w-[72ch] whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-2">{r.body}</p>
            </CardBody>
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line px-4 py-3 text-[13px]">
              <dt className="text-muted">From</dt>
              <dd className="text-ink">{r.customer_name}</dd>
              <dt className="text-muted">Email</dt>
              <dd className="break-all text-ink">{r.customer_email ?? "Not provided"}</dd>
              {r.customer_phone ? (
                <>
                  <dt className="text-muted">Phone</dt>
                  <dd className="text-ink">{r.customer_phone}</dd>
                </>
              ) : null}
              <dt className="text-muted">Customer record</dt>
              <dd className="text-ink">{d.customer ? `Matched: ${d.customer.full_name}, customer since ${formatDate(d.customer.created_at, tz)}` : "No match. Orders and tickets are not looked up for unmatched senders."}</dd>
              <dt className="text-muted">Channel</dt>
              <dd className="text-ink">{CHANNEL_LABELS[r.channel]}</dd>
              <dt className="text-muted">Assigned to</dt>
              <dd className="text-ink">{r.assignee_name ?? "Unassigned"}</dd>
              {r.created_by_name ? (
                <>
                  <dt className="text-muted">Entered by</dt>
                  <dd className="text-ink">{r.created_by_name}</dd>
                </>
              ) : null}
            </dl>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>AI interpretation</CardTitle>
                <CardDescription>
                  {current
                    ? current.source === "human"
                      ? `Corrected by ${current.created_by_name ?? "staff"}. The original AI reading is kept below.`
                      : `From ${current.provider ?? "AI"} (${current.model ?? "unknown model"}), prompt ${current.prompt_version ?? "n/a"}.`
                    : "Not processed yet."}
                </CardDescription>
              </div>
              {current && can(ctx, "requests.correct_classification") ? (
                <CorrectClassification requestId={r.id} category={current.category} summary={current.summary} categories={d.categories} />
              ) : null}
            </CardHeader>
            {current ? (
              <CardBody className="flex flex-col gap-3">
                <div>
                  <p className="text-xs font-medium text-muted">Summary</p>
                  <p className="mt-0.5 text-[14px] text-ink">{current.summary}</p>
                  {current.key_points.length ? (
                    <ul className="mt-1.5 list-disc pl-5 text-[13px] text-ink-2">
                      {current.key_points.map((k, i) => (
                        <li key={i}>{k}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                  <dt className="text-muted">Category</dt>
                  <dd className="text-ink">{d.categories.find((c) => c.key === current.category)?.label ?? humanize(current.category)}</dd>
                  {current.uncertainty_level ? (
                    <>
                      <dt className="text-muted">Uncertainty</dt>
                      <dd className="text-ink">
                        <Badge tone={current.uncertainty_level === "high" ? "red" : current.uncertainty_level === "medium" ? "amber" : "neutral"}>{humanize(current.uncertainty_level)}</Badge>{" "}
                        <span className="text-ink-2">{current.uncertainty_notes}</span>
                        <span className="block text-2xs text-faint">Self-reported by the model; not a calibrated probability.</span>
                      </dd>
                    </>
                  ) : null}
                  {current.missing_information.length ? (
                    <>
                      <dt className="text-muted">Missing</dt>
                      <dd className="text-ink">{current.missing_information.join(", ")}</dd>
                    </>
                  ) : null}
                  {current.suggested_next_step ? (
                    <>
                      <dt className="text-muted">Suggested next step</dt>
                      <dd className="text-ink">{current.suggested_next_step}</dd>
                    </>
                  ) : null}
                </dl>
                <ExtractedFields fields={current.extracted_fields} />
                {d.classifications.length > 1 ? (
                  <details className="rounded-md border border-line px-3 py-2 text-[13px]">
                    <summary className="cursor-pointer text-ink-2">History ({d.classifications.length} versions)</summary>
                    <ul className="mt-2 flex flex-col gap-2">
                      {d.classifications.map((c) => (
                        <li key={c.id} className="border-l-2 border-line pl-2.5">
                          <p className="text-xs text-muted">
                            {c.source === "ai" ? `AI (${c.model ?? "model"})` : `Correction by ${c.created_by_name ?? "staff"}`}, {formatDateTime(c.created_at, tz)}
                            {c.is_current ? ", current" : ""}
                            {c === originalAi && !c.is_current ? ", original AI output" : ""}
                          </p>
                          <p className="text-ink-2">
                            {humanize(c.category)}: {c.summary}
                          </p>
                          {c.correction_reason ? <p className="text-xs text-muted">Reason: {c.correction_reason}</p> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </CardBody>
            ) : (
              <CardBody>
                <p className="text-[13px] text-muted">Process the request with AI, or handle it manually with New action.</p>
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Business records found</CardTitle>
                <CardDescription>Retrieved by RelayOps from this business&apos;s records. The AI may only state facts listed here.</CardDescription>
              </div>
            </CardHeader>
            {d.evidence.length ? (
              <ul className="divide-y divide-line">
                {d.evidence.map((e) => (
                  <li key={e.id} id={`evidence-${e.ref.replace(":", "-")}`} className="scroll-mt-20 px-4 py-2.5 target:bg-accent-soft/50">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-[13px] font-medium text-ink">{e.label}</p>
                      <span className="text-2xs text-muted">{e.match_reason}</span>
                    </div>
                    <dl className="mt-1 grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                      {Object.entries(e.facts)
                        .filter(([k, v]) => v !== null && !k.endsWith("_id") && !k.endsWith("_cents"))
                        .map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-muted">{humanize(k)}</dt>
                            <dd className="text-ink-2">{typeof v === "string" && /^[a-z]+(_[a-z]+)+$/.test(v) ? v.replace(/_/g, " ") : String(v)}</dd>
                          </div>
                        ))}
                    </dl>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody>
                <p className="text-[13px] text-muted">{r.ai_status === "not_started" ? "Records are retrieved when the request is processed." : "No matching records were found."}</p>
              </CardBody>
            )}
          </Card>
        </div>

        {/* Right: what to do */}
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="proposals-heading">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 id="proposals-heading" className="text-[15px] font-semibold text-ink">
                Proposed actions
              </h2>
              <span className="text-xs text-muted">Nothing runs until a person executes it.</span>
            </div>
            <div className="flex flex-col gap-4">
              {openProposals.length ? (
                openProposals.map(card)
              ) : (
                <Card>
                  <CardBody>
                    <p className="text-[13px] text-muted">
                      {r.ai_status === "not_started" ? "No proposals yet. Process with AI to draft a response, or create an action yourself." : "No open proposals."}
                    </p>
                  </CardBody>
                </Card>
              )}
              {closedProposals.length ? (
                <details className="group">
                  <summary className="cursor-pointer text-[13px] text-ink-2">Completed and dismissed ({closedProposals.length})</summary>
                  <div className="mt-3 flex flex-col gap-4">{closedProposals.map(card)}</div>
                </details>
              ) : null}
            </div>
          </section>

          {d.deliveries.length ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Messages</CardTitle>
                  <CardDescription>Recorded by the simulated delivery adapter. No real email was sent.</CardDescription>
                </div>
              </CardHeader>
              <ul className="divide-y divide-line">
                {d.deliveries.map((m) => (
                  <li key={m.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <SimulatedBadge />
                      <span className="text-xs text-muted">
                        To {m.to_address}, {formatDateTime(m.created_at, tz)}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] font-medium text-ink">{m.subject}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-2">{m.body}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {d.notes.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Internal notes</CardTitle>
              </CardHeader>
              <ul className="divide-y divide-line">
                {d.notes.map((n) => (
                  <li key={n.id} className="px-4 py-2.5">
                    <p className="whitespace-pre-wrap text-[13px] text-ink-2">{n.body}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {n.author_name ?? "Staff"}, {formatDateTime(n.created_at, tz)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Activity</CardTitle>
                <CardDescription>Every recorded step for this request, newest first. The log cannot be edited.</CardDescription>
              </div>
            </CardHeader>
            <ol className="relative px-4 py-3">
              {d.timeline.map((e) => (
                <li key={e.id} className="relative border-l border-line pb-3 pl-4 last:pb-0">
                  <span
                    aria-hidden
                    className={`absolute -left-[4.5px] top-1.5 size-2 rounded-full ${e.result === "failure" ? "bg-red" : e.result === "denied" ? "bg-amber" : e.actor_type === "ai" ? "bg-violet" : "bg-line-strong"}`}
                  />
                  <p className="text-[13px] text-ink-2">
                    {e.actor_type === "ai" ? <Bot aria-label="AI" className="mr-1 inline size-3.5 text-violet" /> : null}
                    {describeEvent(e)}
                    {e.result === "denied" ? <span className="ml-1 text-xs text-amber">(refused)</span> : e.result === "failure" ? <span className="ml-1 text-xs text-red">(failed)</span> : null}
                  </p>
                  <p className="text-2xs text-faint">
                    {formatDateTime(e.created_at, tz)}
                    {e.actor_name && e.actor_type !== "user" ? `, triggered by ${e.actor_name}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </Card>

          {d.aiRuns.length ? (
            <details className="rounded-lg border border-line bg-surface px-4 py-3 text-[13px] shadow-raise">
              <summary className="cursor-pointer font-medium text-ink-2">AI usage for this request</summary>
              <table className="mt-2 w-full text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 text-left font-medium">Task</th>
                    <th className="py-1 text-left font-medium">Model</th>
                    <th className="py-1 text-left font-medium">Result</th>
                    <th className="py-1 text-right font-medium">Tokens in/out</th>
                    <th className="py-1 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {d.aiRuns.map((a, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-1">{humanize(a.task)}</td>
                      <td className="py-1">
                        {a.provider}/{a.model}
                      </td>
                      <td className={`py-1 ${a.status === "failed" ? "text-red" : ""}`}>{a.status === "failed" ? `Failed (${a.error_code})` : "OK"}</td>
                      <td className="tabular py-1 text-right">
                        {a.input_tokens ?? "–"}/{a.output_tokens ?? "–"}
                      </td>
                      <td className="tabular py-1 text-right">{a.latency_ms ?? 0} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-2xs text-faint">Mock provider token counts are estimates. Prompts and completions are not stored.</p>
            </details>
          ) : null}
        </div>
      </div>
    </>
  );
}

function ExtractedFields({ fields }: { fields: Record<string, unknown> }) {
  const entries = Object.entries(fields).filter(([k, v]) => k !== "input_truncated" && v !== null && !(Array.isArray(v) && v.length === 0));
  if (!entries.length) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted">Details the customer gave</p>
      <dl className="mt-1 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[13px]">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{humanize(k)}</dt>
            <dd className="text-ink-2">{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
          </div>
        ))}
      </dl>
      {fields.input_truncated ? <p className="mt-1 text-2xs text-amber">The message was long; only the first part was sent to the AI.</p> : null}
    </div>
  );
}
