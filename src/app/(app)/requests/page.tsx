import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { requireUser } from "@/server/auth/context";
import { inboxFilterSchema, listRequests, nextAction } from "@/server/requests/queries";
import { withTenant } from "@/server/db/tenant";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { PriorityBadge, RequestStatusBadge, UnresolvedBadge, Badge } from "@/components/app/badges";
import { Pagination } from "@/components/app/pagination";
import { REQUEST_STATUSES, REQUEST_STATUS_LABELS } from "@/lib/domain";
import { relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Requests" };

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const ctx = await requireUser();
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const filters = inboxFilterSchema.parse(flat);
  const [data, meta] = await Promise.all([
    listRequests(ctx, filters),
    withTenant(ctx, async (tx) => ({
      categories: await tx.many<{ key: string; label: string }>("select key, label from request_categories order by sort_order, label"),
      team: await tx.many<{ user_id: string; full_name: string }>(
        "select m.user_id, p.full_name from business_memberships m join profiles p on p.id = m.user_id where m.status = 'active' order by p.full_name",
      ),
    })),
  ]);
  const active = Object.entries(filters).some(([k, v]) => k !== "page" && v);

  return (
    <>
      <PageHeader
        title="Requests"
        description={ctx.role === "member" ? "Showing requests assigned to you and unassigned requests." : "All customer requests for this business."}
        actions={
          <Button asChild variant="primary">
            <Link href="/requests/new">New request</Link>
          </Button>
        }
      />

      <Card>
        <form method="get" className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto_auto_auto]" role="search" aria-label="Filter requests">
          <Input name="q" defaultValue={filters.q} placeholder="Search name, subject, message or REQ number" aria-label="Search" />
          <Select name="status" defaultValue={filters.status ?? ""} aria-label="Status">
            <option value="">Any status</option>
            {REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {REQUEST_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select name="category" defaultValue={filters.category ?? ""} aria-label="Category">
            <option value="">Any category</option>
            {meta.categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
          <Select name="assignee" defaultValue={filters.assignee ?? ""} aria-label="Assigned to">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {meta.team.map((t) => (
              <option key={t.user_id} value={t.user_id}>
                {t.full_name}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <span className="w-8 shrink-0 sm:w-auto">From</span>
            <Input type="date" name="from" defaultValue={filters.from} aria-label="Received from" title="Received on or after" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <span className="w-8 shrink-0 sm:w-auto">To</span>
            <Input type="date" name="to" defaultValue={filters.to} aria-label="Received until" title="Received on or before" />
          </label>
          <div className="flex gap-2">
            <Button type="submit">Apply</Button>
            {active ? (
              <Button asChild variant="ghost">
                <Link href="/requests">Clear</Link>
              </Button>
            ) : null}
          </div>
        </form>

        {data.rows.length === 0 ? (
          <EmptyState title={active ? "No requests match these filters" : "No requests yet"} action={<Button asChild><Link href="/requests/new">Create a request</Link></Button>}>
            {active ? "Try clearing a filter." : "Create one manually or generate a demo scenario."}
          </EmptyState>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Request</TH>
                    <TH>Customer</TH>
                    <TH>Category</TH>
                    <TH>Status</TH>
                    <TH>Assigned</TH>
                    <TH>Next step</TH>
                    <TH className="text-right">Received</TH>
                  </tr>
                </THead>
                <tbody>
                  {data.rows.map((r) => (
                    <TR key={r.id} className="hover:bg-sunken/40">
                      <TD className="max-w-[340px]">
                        <Link href={`/requests/${r.id}`} className="group block">
                          <span className="font-mono text-xs text-muted">{r.reference}</span>
                          <span className="block truncate font-medium text-ink group-hover:text-accent group-hover:underline">{r.subject}</span>
                          {r.summary ? <span className="block truncate text-xs text-muted">{r.summary}</span> : null}
                        </Link>
                      </TD>
                      <TD className="whitespace-nowrap">{r.customer_name}</TD>
                      <TD className="whitespace-nowrap text-ink-2">{r.category_label ?? <span className="text-faint">Not classified</span>}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <RequestStatusBadge status={r.status} />
                          <PriorityBadge priority={r.priority} />
                          {r.flagged_unresolved_at && !["completed", "rejected"].includes(r.status) ? <UnresolvedBadge /> : null}
                          {r.needs_human_review && !["completed", "rejected"].includes(r.status) ? (
                            <Badge tone="amber" icon={AlertTriangle} title="Flagged for careful human review">
                              Review flags
                            </Badge>
                          ) : null}
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap text-ink-2">{r.assignee_name ?? <span className="text-faint">Unassigned</span>}</TD>
                      <TD className="text-xs text-ink-2">{nextAction(r)}</TD>
                      <TD className="whitespace-nowrap text-right text-xs text-muted tabular" title={new Date(r.received_at).toISOString()}>
                        {relativeTime(r.received_at)}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {data.rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/requests/${r.id}`} className="block px-4 py-3 hover:bg-sunken/40">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs text-muted">{r.reference}</span>
                      <span className="text-xs text-muted">{relativeTime(r.received_at)}</span>
                    </div>
                    <p className="mt-0.5 font-medium text-ink">{r.subject}</p>
                    <p className="text-xs text-muted">
                      {r.customer_name}
                      {r.category_label ? `, ${r.category_label}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <RequestStatusBadge status={r.status} />
                      <PriorityBadge priority={r.priority} />
                      {r.flagged_unresolved_at && !["completed", "rejected"].includes(r.status) ? <UnresolvedBadge /> : null}
                    </div>
                    <p className="mt-1.5 text-xs text-ink-2">{nextAction(r)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <Pagination page={data.page} pageCount={data.pageCount} total={data.total} basePath="/requests" params={flat as Record<string, string | undefined>} />
      </Card>
    </>
  );
}
