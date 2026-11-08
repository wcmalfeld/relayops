import type { Metadata } from "next";
import { requireUser } from "@/server/auth/context";
import { getSettingsData } from "@/server/team/service";
import { can, permissionsFor } from "@/server/auth/permissions";
import { PageHeader, Notice } from "@/components/app/page-header";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/app/badges";
import { AddMemberDialog, BusinessSettingsForm, CategoryRow, CreateKey, MemberControls, RevokeKey } from "./settings-forms";
import { ACTION_META, ACTION_TYPES } from "@/lib/domain";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireUser();
  const d = await getSettingsData(ctx);
  const owner = can(ctx, "settings.manage");
  const s = d.business.settings;

  return (
    <>
      <PageHeader title="Settings" description={owner ? "Business configuration, team, categories and integrations." : "Read-only for team members. Ask an owner to change settings."} />
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Business</CardTitle>
          </CardHeader>
          <CardBody>
            <BusinessSettingsForm
              disabled={!owner}
              initial={{
                name: d.business.name,
                support_email: d.business.supportEmail ?? "",
                timezone: d.business.timezone,
                public_intake_enabled: s.public_intake_enabled,
                member_request_visibility: s.member_request_visibility,
                medium_risk_requires_approval: s.medium_risk_requires_approval,
                min_sample_for_metrics: s.min_sample_for_metrics,
                response_sign_off: s.response_sign_off,
                return_window_days: s.return_window_days,
              }}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Action approval policy</CardTitle>
              <CardDescription>Defined in application code. Rules and settings can add approval steps but cannot remove them.</CardDescription>
            </div>
          </CardHeader>
          <Table>
            <THead>
              <tr>
                <TH>Action</TH>
                <TH>Risk when executed</TH>
                <TH>Approval</TH>
                <TH>Effect</TH>
              </tr>
            </THead>
            <tbody>
              {ACTION_TYPES.map((t) => {
                const m = ACTION_META[t];
                const needs = m.risk === "high" || (m.risk === "medium" && s.medium_risk_requires_approval);
                return (
                  <TR key={t}>
                    <TD className="font-medium">{m.label}</TD>
                    <TD>
                      <Badge tone={m.risk === "high" ? "amber" : "blue"}>{m.risk === "high" ? "High" : "Medium"}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap">{needs ? "Owner approval" : "Permitted member"}</TD>
                    <TD className="text-ink-2">{m.effect}</TD>
                  </TR>
                );
              })}
              <TR>
                <TD className="font-medium">Classify, summarize, search records, draft a reply</TD>
                <TD>
                  <Badge tone="neutral">Low</Badge>
                </TD>
                <TD>Automatic</TD>
                <TD className="text-ink-2">Changes nothing outside RelayOps; results wait for human review.</TD>
              </TR>
              <TR>
                <TD className="font-medium">Move money, issue refunds, delete data, change permissions, arbitrary external calls</TD>
                <TD>
                  <Badge tone="red">Critical</Badge>
                </TD>
                <TD>Not available</TD>
                <TD className="text-ink-2">Not implemented. AI attempts are refused and recorded in the audit log.</TD>
              </TR>
            </tbody>
          </Table>
        </Card>

        <Card id="categories">
          <CardHeader>
            <div>
              <CardTitle>Request categories and time-saved inputs</CardTitle>
              <CardDescription>
                Manual minutes: typical handling time without assistance. Assisted minutes: typical review time with RelayOps. The dashboard estimate is
                the difference, summed over completed AI-assisted requests.
              </CardDescription>
            </div>
          </CardHeader>
          <div className="hidden gap-2 border-b border-line px-4 py-1.5 text-xs text-muted md:grid md:grid-cols-[auto_minmax(0,1fr)_7rem_7rem_auto]">
            <span>On</span>
            <span>Label and description</span>
            <span>Manual min</span>
            <span>Assisted min</span>
            <span />
          </div>
          {owner ? (
            <div className="divide-y divide-line">
              {d.categories.map((c) => (
                <CategoryRow key={c.id} c={{ id: c.id, label: c.label, description: c.description, is_enabled: c.is_enabled, baseline_manual_minutes: c.baseline_manual_minutes, assisted_minutes: c.assisted_minutes }} />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {d.categories.map((c) => (
                <li key={c.id} className="flex justify-between gap-2 px-4 py-2 text-[13px]">
                  <span>{c.label}</span>
                  <span className="tabular text-muted">
                    {c.baseline_manual_minutes} / {c.assisted_minutes} min
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Team</CardTitle>
              <CardDescription>Roles are enforced on the server and in the database. Owners approve high-risk actions.</CardDescription>
            </div>
            {can(ctx, "team.manage") ? <AddMemberDialog /> : null}
          </CardHeader>
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Title</TH>
                <TH>Access</TH>
              </tr>
            </THead>
            <tbody>
              {d.team.map((m) => (
                <TR key={m.membership_id}>
                  <TD className="font-medium">{m.full_name}</TD>
                  <TD className="text-ink-2">{m.email}</TD>
                  <TD className="text-ink-2">{m.title ?? "None"}</TD>
                  <TD>
                    {can(ctx, "team.manage") ? (
                      <MemberControls m={{ membership_id: m.membership_id, role: m.role, status: m.status, full_name: m.full_name }} self={m.user_id === ctx.userId} />
                    ) : (
                      <span>
                        {m.role === "owner" ? "Owner" : "Team member"}
                        {m.status === "disabled" ? ", disabled" : ""}
                      </span>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <CardBody className="border-t border-line text-xs text-muted">
            Your permissions: {permissionsFor(ctx.role).length} of the defined permissions ({ctx.role === "owner" ? "owner" : "team member"}).
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>What is real and what is simulated in this build.</CardDescription>
            </div>
          </CardHeader>
          <ul className="divide-y divide-line text-[13px]">
            <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span>
                <span className="font-medium">AI provider</span>
                <span className="block text-xs text-muted">
                  {d.ai.provider} ({d.ai.model}), timeout {d.ai.timeoutMs / 1000}s, {d.ai.maxRetries} retries, {d.ai.runsPerHour} runs per hour, input capped at {d.ai.maxInputChars} characters
                </span>
              </span>
              <Badge tone={d.ai.provider === "mock" ? "violet" : d.ai.provider === "unavailable" ? "red" : "accent"}>
                {d.ai.provider === "mock" ? "Mock provider" : d.ai.provider === "unavailable" ? "Simulated outage" : d.ai.keyConfigured ? "Configured" : "Key missing"}
              </Badge>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span>
                <span className="font-medium">Customer message delivery</span>
                <span className="block text-xs text-muted">Messages are recorded in the outbox only. No email provider is connected.</span>
              </span>
              <Badge tone="violet">Simulated</Badge>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span>
                <span className="font-medium">Email inbox, e-commerce, point of sale, CRM, payments</span>
                <span className="block text-xs text-muted">Not connected. Use the intake API to bring requests in from other systems.</span>
              </span>
              <Badge tone="muted">Not connected</Badge>
            </li>
          </ul>
        </Card>

        {owner ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Intake API keys</CardTitle>
                <CardDescription>
                  For <code className="font-mono">POST /api/v1/requests</code>. A key can only create requests in this business.
                </CardDescription>
              </div>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <CreateKey />
              {d.keys.length ? (
                <Table>
                  <THead>
                    <tr>
                      <TH>Name</TH>
                      <TH>Prefix</TH>
                      <TH>Created</TH>
                      <TH>Last used</TH>
                      <TH />
                    </tr>
                  </THead>
                  <tbody>
                    {d.keys.map((k) => (
                      <TR key={k.id}>
                        <TD>{k.name}</TD>
                        <TD className="font-mono text-xs">{k.key_prefix}…</TD>
                        <TD className="text-ink-2">{formatDateTime(k.created_at)}</TD>
                        <TD className="text-ink-2">{k.last_used_at ? formatDateTime(k.last_used_at) : "Never"}</TD>
                        <TD className="text-right">{k.revoked_at ? <Badge tone="muted">Revoked</Badge> : <RevokeKey id={k.id} />}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              ) : null}
            </CardBody>
          </Card>
        ) : (
          <Notice>Intake API keys are managed by owners.</Notice>
        )}
      </div>
    </>
  );
}
