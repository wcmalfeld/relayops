import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/context";
import { auditFilterSchema, listAuditEvents } from "@/server/audit/queries";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/app/badges";
import { Pagination } from "@/components/app/pagination";
import { describeEvent } from "@/lib/events";
import { formatDateTime, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };

const RESULT_TONE = { success: "accent", failure: "red", denied: "amber", info: "neutral" } as const;

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const ctx = await requireUser();
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const filters = auditFilterSchema.parse(flat);
  const data = await listAuditEvents(ctx, filters);

  return (
    <>
      <PageHeader
        title="Audit log"
        description={
          ctx.role === "owner"
            ? "Append-only record of everything that happened in this business. Message content and contact details are not stored here."
            : "Events on requests you can see, and events you caused."
        }
      />
      <Card>
        <form method="get" className="flex flex-wrap items-center gap-2 border-b border-line p-3" aria-label="Filter audit events">
          <Select name="type" defaultValue={filters.type ?? ""} aria-label="Event type" className="w-auto">
            <option value="">All event types</option>
            {data.prefixes.map((p) => (
              <option key={p} value={p}>
                {humanize(p)}
              </option>
            ))}
          </Select>
          <Select name="result" defaultValue={filters.result ?? ""} aria-label="Result" className="w-auto">
            <option value="">Any result</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="denied">Denied</option>
            <option value="info">Info</option>
          </Select>
          <Select name="actor" defaultValue={filters.actor ?? ""} aria-label="Actor" className="w-auto">
            <option value="">Any actor</option>
            <option value="user">People</option>
            <option value="ai">AI</option>
            <option value="system">System and rules</option>
            <option value="public">Public form</option>
          </Select>
          <Button type="submit">Apply</Button>
          {filters.type || filters.result || filters.actor ? (
            <Button asChild variant="ghost">
              <Link href="/audit">Clear</Link>
            </Button>
          ) : null}
        </form>
        {data.rows.length === 0 ? (
          <EmptyState title="No events match" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Event</TH>
                <TH>Actor</TH>
                <TH>Result</TH>
                <TH>Request</TH>
                <TH>Details</TH>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-xs text-muted tabular">{formatDateTime(e.created_at)}</TD>
                  <TD className="min-w-[260px]">
                    <p className="text-ink">{describeEvent(e)}</p>
                    <p className="font-mono text-2xs text-faint">{e.event_type}</p>
                  </TD>
                  <TD className="whitespace-nowrap text-ink-2">
                    {e.actor_type === "user" ? (e.actor_name ?? "User") : humanize(e.actor_type)}
                    {e.actor_type !== "user" && e.actor_name ? <span className="block text-2xs text-muted">for {e.actor_name}</span> : null}
                  </TD>
                  <TD>
                    <Badge tone={RESULT_TONE[e.result as keyof typeof RESULT_TONE] ?? "neutral"}>{humanize(e.result)}</Badge>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {e.request_id ? (
                      <Link href={`/requests/${e.request_id}`} className="font-mono text-xs text-accent hover:underline">
                        {e.reference}
                      </Link>
                    ) : (
                      <span className="text-faint">None</span>
                    )}
                  </TD>
                  <TD className="max-w-[320px]">
                    {Object.keys(e.metadata).length ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-ink-2">Metadata</summary>
                        <pre className="mt-1 max-h-48 overflow-auto rounded-sm bg-sunken p-2 font-mono text-2xs text-ink-2">{JSON.stringify(e.metadata, null, 2)}</pre>
                      </details>
                    ) : (
                      <span className="text-faint">None</span>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={data.page} pageCount={data.pageCount} total={data.total} basePath="/audit" params={flat as Record<string, string | undefined>} />
      </Card>
    </>
  );
}
