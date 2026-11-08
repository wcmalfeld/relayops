import "server-only";
import { z } from "zod";
import { withTenant } from "@/server/db/tenant";
import type { UserContext } from "@/server/auth/types";
import { assertCan } from "@/server/auth/permissions";
import { recordAudit } from "@/server/audit/audit";
import { invalid, notFound } from "@/server/errors";
import { loadBusiness } from "@/server/settings/business";
import { returnEligibility } from "@/server/records/policy-rules";

export async function getRecords(ctx: UserContext) {
  return withTenant(ctx, async (tx) => {
    const business = await loadBusiness(tx);
    const products = await tx.many<{ id: string; sku: string; name: string; brand: string | null; category: string; price_cents: number; is_active: boolean; on_hand: number; reserved: number; inventory_id: string | null }>(
      `select p.id, p.sku, p.name, p.brand, p.category, p.price_cents, p.is_active,
              coalesce(i.quantity_on_hand, 0) as on_hand, coalesce(i.quantity_reserved, 0) as reserved, i.id as inventory_id
         from products p left join inventory_records i on i.product_id = p.id and i.location = 'Main store'
        order by p.category, p.name`,
    );
    const orders = await tx.many<{ id: string; order_number: string; customer_name: string; status: string; fulfillment: string; total_cents: number; placed_at: Date; expected_at: Date | null; delivered_at: Date | null; carrier: string | null; tracking_number: string | null }>(
      `select o.id, o.order_number, c.full_name as customer_name, o.status, o.fulfillment, o.total_cents, o.placed_at,
              o.expected_at, o.delivered_at, o.carrier, o.tracking_number
         from orders o join customers c on c.id = o.customer_id order by o.placed_at desc`,
    );
    const services = await tx.many<{ id: string; ticket_number: string; customer_name: string; bike_description: string; issue_summary: string; service_type: string; status: string; quoted_cents: number | null; updated_at: Date; from_proposal: boolean }>(
      `select s.id, s.ticket_number, c.full_name as customer_name, s.bike_description, s.issue_summary, s.service_type, s.status,
              s.quoted_cents, s.updated_at, s.source_proposal_id is not null as from_proposal
         from service_requests s join customers c on c.id = s.customer_id order by s.updated_at desc`,
    );
    const appointments = await tx.many<{ id: string; starts_at: Date; ends_at: Date; service_type: string; technician_name: string | null; status: string; customer_name: string | null; booked_by_proposal: boolean }>(
      `select a.id, a.starts_at, a.ends_at, a.service_type, a.technician_name, a.status, c.full_name as customer_name,
              a.booked_by_proposal_id is not null as booked_by_proposal
         from appointments a left join customers c on c.id = a.customer_id
        where a.starts_at > now() - interval '1 day' order by a.starts_at limit 60`,
    );
    const customers = await tx.many<{ id: string; full_name: string; email: string | null; phone: string | null; created_at: Date; orders: number; requests: number }>(
      `select c.id, c.full_name, c.email, c.phone, c.created_at,
              (select count(*)::int from orders o where o.customer_id = c.id) as orders,
              (select count(*)::int from customer_requests r where r.customer_id = c.id) as requests
         from customers c order by c.full_name`,
    );
    const policies = await tx.many<{ id: string; policy_key: string; title: string; body: string; categories: string[]; updated_at: Date }>(
      "select id, policy_key, title, body, categories, updated_at from business_policies order by title",
    );
    const refunds = await tx.many<{ id: string; order_number: string; customer_name: string; amount_cents: number; reason: string; status: string; created_at: Date }>(
      `select rr.id, o.order_number, c.full_name as customer_name, rr.amount_cents, rr.reason, rr.status, rr.created_at
         from refund_requests rr join orders o on o.id = rr.order_id join customers c on c.id = rr.customer_id
        order by rr.created_at desc`,
    );
    const deliveries = await tx.many<{ id: string; to_address: string; subject: string; simulated: boolean; status: string; created_at: Date; reference: string; request_id: string }>(
      `select d.id, d.to_address, d.subject, d.simulated, d.status, d.created_at, r.reference, r.id as request_id
         from message_deliveries d join customer_requests r on r.id = d.request_id order by d.created_at desc limit 50`,
    );
    return {
      business,
      products,
      orders: orders.map((o) => ({ ...o, return_eligibility: returnEligibility(o, business.settings.return_window_days).status })),
      services,
      appointments,
      customers,
      policies,
      refunds,
      deliveries,
    };
  });
}

export const inventoryUpdateSchema = z.strictObject({
  product_id: z.uuid(),
  quantity_on_hand: z.coerce.number().int().min(0).max(100_000),
});

export async function updateInventory(ctx: UserContext, input: unknown) {
  assertCan(ctx, "records.manage");
  const data = inventoryUpdateSchema.parse(input);
  return withTenant(ctx, async (tx) => {
    const row = await tx.maybeOne<{ id: string; quantity_on_hand: number; quantity_reserved: number }>(
      "select id, quantity_on_hand, quantity_reserved from inventory_records where product_id = $1 and location = 'Main store' for update",
      [data.product_id],
    );
    if (!row) throw notFound("Inventory record not found.");
    if (data.quantity_on_hand < row.quantity_reserved) throw invalid(`Cannot go below the ${row.quantity_reserved} units reserved for orders.`);
    await tx.exec("update inventory_records set quantity_on_hand = $2, updated_at = now() where id = $1", [row.id, data.quantity_on_hand]);
    await recordAudit(tx, ctx, {
      eventType: "record.updated",
      result: "success",
      entityType: "inventory_record",
      entityId: row.id,
      metadata: { field: "quantity_on_hand", from: row.quantity_on_hand, to: data.quantity_on_hand, product_id: data.product_id },
    });
  });
}

export const serviceStatusSchema = z.strictObject({
  service_request_id: z.uuid(),
  status: z.enum(["open", "scheduled", "in_progress", "awaiting_parts", "completed", "cancelled"]),
});

export async function updateServiceStatus(ctx: UserContext, input: unknown) {
  assertCan(ctx, "records.update_operational");
  const data = serviceStatusSchema.parse(input);
  return withTenant(ctx, async (tx) => {
    const row = await tx.maybeOne<{ status: string }>("select status from service_requests where id = $1 for update", [data.service_request_id]);
    if (!row) throw notFound("Service ticket not found.");
    if (row.status === data.status) return;
    await tx.exec("update service_requests set status = $2 where id = $1", [data.service_request_id, data.status]);
    await recordAudit(tx, ctx, {
      eventType: "record.updated",
      result: "success",
      entityType: "service_request",
      entityId: data.service_request_id,
      metadata: { field: "status", from: row.status, to: data.status },
    });
  });
}

export const policyUpdateSchema = z.strictObject({
  policy_id: z.uuid(),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
});

export async function updatePolicy(ctx: UserContext, input: unknown) {
  assertCan(ctx, "records.manage");
  const data = policyUpdateSchema.parse(input);
  return withTenant(ctx, async (tx) => {
    const n = await tx.exec("update business_policies set title = $2, body = $3, updated_by = $4 where id = $1", [data.policy_id, data.title, data.body, ctx.userId]);
    if (!n) throw notFound("Policy not found.");
    await recordAudit(tx, ctx, {
      eventType: "record.updated",
      result: "success",
      entityType: "business_policy",
      entityId: data.policy_id,
      metadata: { field: "policy_text", length: data.body.length },
    });
  });
}
