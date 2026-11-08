import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/context";
import { getDashboardMetrics } from "@/server/metrics/metrics";
import { can } from "@/server/auth/permissions";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CategoryChart } from "@/components/app/category-chart";
import { UnresolvedCheckButton } from "./unresolved-check-button";
import { describeEvent } from "@/lib/events";
import { relativeTime } from "@/lib/utils";
import { Badge } from "@/components/app/badges";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const ctx = await requireUser();
  const m = await getDashboardMetrics(ctx);
  const isDemo = m.business.isDemo || m.demoShare.demo > 0;

  const stats = [
    { label: "New requests", value: m.counts.new_count, href: "/requests?status=new", hint: "Not yet processed" },
    { label: "Needs review", value: m.counts.needs_review, href: "/requests?status=needs_review", hint: "Waiting for a person" },
    { label: "Awaiting approval", value: m.actions.pending_approval, href: "/approvals", hint: "Actions an owner must approve", strong: m.actions.pending_approval > 0 },
    { label: "Actions executed", value: m.actions.executed, href: "/audit?type=action", hint: `${m.actions.failed} failed, ${m.actions.blocked} blocked by policy` },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${m.business.name}. Counts are live from the database.`}
        actions={
          <>
            {can(ctx, "rules.manage") ? <UnresolvedCheckButton /> : null}
            <Button asChild variant="primary">
              <Link href="/requests/new">New request</Link>
            </Button>
          </>
        }
      />

      {isDemo ? (
        <p className="mb-4 text-[13px] text-muted">
          All figures below come from demonstration data ({m.demoShare.demo} of {m.demoShare.total} requests are seeded or generated demo requests).
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-raise lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="group bg-surface px-4 py-3.5 hover:bg-sunken/50">
            <p className="text-[13px] text-muted">{s.label}</p>
            <p className={`tabular mt-1 text-[28px] font-semibold leading-8 ${s.strong ? "text-amber" : "text-ink"}`}>{s.value}</p>
            <p className="mt-1 text-xs text-faint group-hover:text-muted">{s.hint}</p>
          </Link>
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Requests by category</CardTitle>
              <CardDescription>All requests, including resolved ones. Categories are configurable in Settings.</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            {m.byCategory.length ? <CategoryChart data={m.byCategory.map((c) => ({ label: c.label, count: c.count }))} /> : <p className="text-[13px] text-muted">No requests yet.</p>}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Time to resolution</CardTitle>
                <CardDescription>Measured from when a request was received to when it was completed.</CardDescription>
              </div>
              <Badge tone="accent">Measured</Badge>
            </CardHeader>
            <CardBody>
              {m.resolution.sufficient ? (
                <div className="flex items-baseline gap-6">
                  <div>
                    <p className="tabular text-2xl font-semibold">{formatHours(m.resolution.median_hours)}</p>
                    <p className="text-xs text-muted">median</p>
                  </div>
                  <div>
                    <p className="tabular text-2xl font-semibold text-ink-2">{formatHours(m.resolution.avg_hours)}</p>
                    <p className="text-xs text-muted">average</p>
                  </div>
                  <p className="text-xs text-muted">across {m.resolution.n} completed requests</p>
                </div>
              ) : (
                <p className="text-[13px] text-muted">
                  Not enough data yet: {m.resolution.n} of {m.resolution.minSample} completed requests needed before an average is shown.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Estimated staff time saved</CardTitle>
                <CardDescription>An estimate from your own inputs, not a measurement.</CardDescription>
              </div>
              <Badge tone="amber">Estimate</Badge>
            </CardHeader>
            <CardBody>
              <p className="tabular text-2xl font-semibold">{formatMinutes(m.timeSaved.minutes)}</p>
              <p className="mt-2 max-w-[60ch] text-xs leading-relaxed text-muted">
                Method: for each of the {m.timeSaved.assistedCompleted} completed requests that AI processing assisted, RelayOps adds that category&apos;s
                manual handling minutes minus its assisted minutes. Both figures are set per category in{" "}
                <Link href="/settings#categories" className="text-accent underline-offset-2 hover:underline">
                  Settings
                </Link>
                . No percentage is claimed.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <div>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>From the audit log.</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/audit">Open audit log</Link>
          </Button>
        </CardHeader>
        <ul className="divide-y divide-line">
          {m.recent.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5">
              <span className="w-20 shrink-0 text-xs text-faint tabular">{relativeTime(e.created_at)}</span>
              <span className="min-w-0 flex-1 text-[13px] text-ink-2">{describeEvent(e)}</span>
              {e.request_id ? (
                <Link href={`/requests/${e.request_id}`} className="font-mono text-xs text-accent hover:underline">
                  {e.reference}
                </Link>
              ) : null}
            </li>
          ))}
          {m.recent.length === 0 ? <li className="px-4 py-6 text-[13px] text-muted">No activity yet.</li> : null}
        </ul>
      </Card>
    </>
  );
}

function formatHours(h: number | null) {
  if (h === null) return "n/a";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

function formatMinutes(min: number) {
  if (min < 60) return `${Math.round(min)} min`;
  return `${(min / 60).toFixed(1)} h`;
}
