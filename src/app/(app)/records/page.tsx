import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth/context";
import { getRecords } from "@/server/records/records";
import { can } from "@/server/auth/permissions";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge, SimulatedBadge } from "@/components/app/badges";
import { InventoryEditor, PolicyEditor, ServiceStatusSelect } from "./record-controls";
import { SERVICE_TYPE_LABELS } from "@/lib/domain";
import { formatDate, formatDateTime, formatMoney, humanize } from "@/lib/utils";
import { stockStatus } from "@/server/records/policy-rules";

export const metadata: Metadata = { title: "Business records" };

export default async function RecordsPage() {
  const ctx = await requireUser();
  const d = await getRecords(ctx);
  const tz = d.business.timezone;
  const manage = can(ctx, "records.manage");
  const ops = can(ctx, "records.update_operational");

  return (
    <>
      <PageHeader
        title="Business records"
        description="The controlled set of records RelayOps searches when it processes a request. The AI can cite these; it cannot change them."
      />
      <Tabs defaultValue="products">
        <TabsList aria-label="Record types" className="mb-4">
          <TabsTrigger value="products">Products and stock ({d.products.length})</TabsTrigger>
          <TabsTrigger value="orders">Orders ({d.orders.length})</TabsTrigger>
          <TabsTrigger value="service">Service tickets ({d.services.length})</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          <TabsTrigger value="customers">Customers ({d.customers.length})</TabsTrigger>
          <TabsTrigger value="policies">Policies ({d.policies.length})</TabsTrigger>
          <TabsTrigger value="refunds">Refund requests ({d.refunds.length})</TabsTrigger>
          <TabsTrigger value="outbox">Message outbox ({d.deliveries.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <Card>
            <Table>
              <THead>
                <tr>
                  <TH>Product</TH>
                  <TH>Category</TH>
                  <TH className="text-right">Price</TH>
                  <TH className="text-right">Reserved</TH>
                  <TH>Availability</TH>
                  <TH className="text-right">On hand</TH>
                </tr>
              </THead>
              <tbody>
                {d.products.map((p) => {
                  const available = Math.max(0, p.on_hand - p.reserved);
                  const s = stockStatus(available);
                  return (
                    <TR key={p.id}>
                      <TD>
                        <p className="font-medium text-ink">{p.name}</p>
                        <p className="font-mono text-2xs text-muted">{p.sku}</p>
                      </TD>
                      <TD className="text-ink-2">{p.category}</TD>
                      <TD className="text-right tabular">{formatMoney(p.price_cents)}</TD>
                      <TD className="text-right tabular text-ink-2">{p.reserved}</TD>
                      <TD>
                        <Badge tone={s === "in_stock" ? "accent" : s === "low_stock" ? "amber" : "red"}>
                          {s === "out_of_stock" ? "Out of stock" : `${available} available${s === "low_stock" ? ", low" : ""}`}
                        </Badge>
                      </TD>
                      <TD className="text-right">
                        {manage && p.inventory_id ? <InventoryEditor productId={p.id} onHand={p.on_hand} reserved={p.reserved} name={p.name} /> : <span className="tabular">{p.on_hand}</span>}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card>
            <Table>
              <THead>
                <tr>
                  <TH>Order</TH>
                  <TH>Customer</TH>
                  <TH>Status</TH>
                  <TH>Placed</TH>
                  <TH>Expected or delivered</TH>
                  <TH>Tracking</TH>
                  <TH>Return window</TH>
                  <TH className="text-right">Total</TH>
                </tr>
              </THead>
              <tbody>
                {d.orders.map((o) => (
                  <TR key={o.id}>
                    <TD className="font-mono text-xs">{o.order_number}</TD>
                    <TD>{o.customer_name}</TD>
                    <TD>
                      <Badge tone={o.status === "delivered" ? "accent" : o.status === "cancelled" ? "muted" : "blue"}>{humanize(o.status)}</Badge>
                    </TD>
                    <TD className="text-ink-2 tabular">{formatDate(o.placed_at, tz)}</TD>
                    <TD className="text-ink-2 tabular">{o.delivered_at ? `Delivered ${formatDate(o.delivered_at, tz)}` : o.expected_at ? `Expected ${formatDate(o.expected_at, tz)}` : "None"}</TD>
                    <TD className="font-mono text-2xs text-ink-2">{o.tracking_number ? `${o.carrier} ${o.tracking_number}` : "None"}</TD>
                    <TD className="text-xs">{o.return_eligibility === "eligible" ? <Badge tone="accent">Open</Badge> : o.return_eligibility === "outside_window" ? <Badge tone="muted">Closed</Badge> : <span className="text-faint">Not delivered</span>}</TD>
                    <TD className="text-right tabular">{formatMoney(o.total_cents)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
          <p className="mt-2 text-xs text-muted">Return window: {d.business.settings.return_window_days} days from delivery, computed by policy code.</p>
        </TabsContent>

        <TabsContent value="service">
          <Card>
            <Table>
              <THead>
                <tr>
                  <TH>Ticket</TH>
                  <TH>Customer</TH>
                  <TH>Bike and issue</TH>
                  <TH>Type</TH>
                  <TH>Quote</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {d.services.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <span className="font-mono text-xs">{s.ticket_number}</span>
                      {s.from_proposal ? <span className="block text-2xs text-muted">From an approved proposal</span> : null}
                    </TD>
                    <TD>{s.customer_name}</TD>
                    <TD className="max-w-[340px]">
                      <p className="text-ink">{s.bike_description}</p>
                      <p className="text-xs text-muted">{s.issue_summary}</p>
                    </TD>
                    <TD className="text-ink-2">{SERVICE_TYPE_LABELS[s.service_type as keyof typeof SERVICE_TYPE_LABELS] ?? s.service_type}</TD>
                    <TD className="tabular">{s.quoted_cents === null ? "None" : formatMoney(s.quoted_cents)}</TD>
                    <TD>{ops ? <ServiceStatusSelect id={s.id} status={s.status} /> : humanize(s.status)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="appointments">
          <Card>
            <Table>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>Service</TH>
                  <TH>Technician</TH>
                  <TH>Status</TH>
                  <TH>Customer</TH>
                </tr>
              </THead>
              <tbody>
                {d.appointments.map((a) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap tabular">{formatDateTime(a.starts_at, tz)}</TD>
                    <TD className="text-ink-2">{SERVICE_TYPE_LABELS[a.service_type as keyof typeof SERVICE_TYPE_LABELS] ?? a.service_type}</TD>
                    <TD className="text-ink-2">{a.technician_name ?? "None"}</TD>
                    <TD>
                      <Badge tone={a.status === "available" ? "accent" : a.status === "booked" ? "blue" : "muted"}>{humanize(a.status)}</Badge>
                      {a.booked_by_proposal ? <span className="ml-1 text-2xs text-muted">via approved proposal</span> : null}
                    </TD>
                    <TD>{a.customer_name ?? <span className="text-faint">Open</span>}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="customers">
          <Card>
            <Table>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Phone</TH>
                  <TH className="text-right">Orders</TH>
                  <TH className="text-right">Requests</TH>
                  <TH>Customer since</TH>
                </tr>
              </THead>
              <tbody>
                {d.customers.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">{c.full_name}</TD>
                    <TD className="text-ink-2">{c.email ?? "None"}</TD>
                    <TD className="text-ink-2">{c.phone ?? "None"}</TD>
                    <TD className="text-right tabular">{c.orders}</TD>
                    <TD className="text-right tabular">{c.requests}</TD>
                    <TD className="text-ink-2 tabular">{formatDate(c.created_at, tz)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="policies">
          <div className="grid gap-4 lg:grid-cols-2">
            {d.policies.map((p) => (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-2.5">
                  <div>
                    <h2 className="text-[14px] font-semibold text-ink">{p.title}</h2>
                    <p className="text-2xs text-muted">Used for: {p.categories.map(humanize).join(", ") || "text search only"}</p>
                  </div>
                  {manage ? <PolicyEditor id={p.id} title={p.title} body={p.body} /> : null}
                </div>
                <p className="max-w-[72ch] px-4 py-3 text-[13px] leading-relaxed text-ink-2">{p.body}</p>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="refunds">
          <Card>
            {d.refunds.length ? (
              <Table>
                <THead>
                  <tr>
                    <TH>Created</TH>
                    <TH>Order</TH>
                    <TH>Customer</TH>
                    <TH>Reason</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Status</TH>
                  </tr>
                </THead>
                <tbody>
                  {d.refunds.map((r) => (
                    <TR key={r.id}>
                      <TD className="tabular text-ink-2">{formatDateTime(r.created_at, tz)}</TD>
                      <TD className="font-mono text-xs">{r.order_number}</TD>
                      <TD>{r.customer_name}</TD>
                      <TD className="max-w-[320px] text-ink-2">{r.reason}</TD>
                      <TD className="text-right tabular">{formatMoney(r.amount_cents)}</TD>
                      <TD>
                        <Badge tone="amber">Pending manual review</Badge>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No refund requests">Approved refund proposals appear here for a manager to handle outside RelayOps. No payment system is connected.</EmptyState>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="outbox">
          <Card>
            {d.deliveries.length ? (
              <Table>
                <THead>
                  <tr>
                    <TH>When</TH>
                    <TH>Request</TH>
                    <TH>To</TH>
                    <TH>Subject</TH>
                    <TH>Delivery</TH>
                  </tr>
                </THead>
                <tbody>
                  {d.deliveries.map((m) => (
                    <TR key={m.id}>
                      <TD className="tabular text-ink-2">{formatDateTime(m.created_at, tz)}</TD>
                      <TD>
                        <Link className="font-mono text-xs text-accent hover:underline" href={`/requests/${m.request_id}`}>
                          {m.reference}
                        </Link>
                      </TD>
                      <TD className="text-ink-2">{m.to_address}</TD>
                      <TD>{m.subject}</TD>
                      <TD>{m.simulated ? <SimulatedBadge /> : humanize(m.status)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No messages yet">Approved customer responses are recorded here by the simulated delivery adapter.</EmptyState>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
