import "server-only";
import { randomUUID } from "node:crypto";
import type { Tx } from "@/server/db/pool";
import type { ClassificationOutput, EvidenceItem } from "@/server/ai/schemas";
import type { BusinessRecord } from "@/server/settings/business";
import { returnEligibility, stockStatus } from "@/server/records/policy-rules";
import { SERVICE_TYPE_LABELS, type ServiceType } from "@/lib/domain";

/**
 * Deterministic retrieval of business records for one request.
 *
 * Retrieval is plain SQL under the caller's tenant context, so RLS limits it
 * to the current business. Customer-specific records (orders, service
 * tickets) are only returned when the sender's email matched a customer
 * record, and only that customer's records. Mentioning another customer's
 * order number yields nothing.
 *
 * `RetrievalService` is the seam for adding semantic search later: a new
 * strategy only has to return EvidenceItems.
 */

export type RetrievalRequest = {
  id: string;
  subject: string;
  body: string;
  customer_id: string | null;
};

export type RetrievalResult = {
  runId: string;
  evidence: EvidenceItem[];
  notes: string[];
};

/**
 * Business record retrieval, separate from the AI service. Implementations
 * must query only through the given tenant-scoped transaction and return
 * EvidenceItems; the AI may cite nothing else.
 */
export interface RetrievalService {
  readonly strategy: string;
  retrieve(tx: Tx, business: BusinessRecord, request: RetrievalRequest, classification: ClassificationOutput): Promise<RetrievalResult>;
}

/** Default strategy: PostgreSQL full-text and trigram search plus exact lookups. */
export const sqlRetrieval: RetrievalService = {
  strategy: "sql-keyword-v1",
  retrieve: (tx, business, request, classification) => retrieveEvidence(tx, business, request, classification),
};

export function getRetrievalService(): RetrievalService {
  return sqlRetrieval;
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtDate(d: Date | string | null, tz: string) {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(d));
}

function fmtDateTime(d: Date | string, tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));
}

const WEEKDAYS: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

const CATEGORY_POLICIES: Record<string, string[]> = {
  order_status: ["order_status"],
  product_availability: ["product_availability"],
  service_repair: ["service_repair"],
  booking: ["booking"],
  return_refund: ["return_refund"],
  product_info: ["product_info"],
  general_question: ["general_question"],
};

const STOPWORDS = new Set(["the", "and", "for", "you", "your", "have", "with", "this", "that", "bike", "bikes", "any", "are", "can", "what", "when", "does", "from", "there", "about", "would", "like"]);

function searchTerms(classification: ClassificationOutput) {
  return classification.extracted.product_terms
    .flatMap((t) => t.toLowerCase().split(/[^a-z0-9-]+/))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .slice(0, 8);
}

export async function retrieveEvidence(
  tx: Tx,
  business: BusinessRecord,
  request: RetrievalRequest,
  classification: ClassificationOutput,
): Promise<RetrievalResult> {
  const tz = business.timezone;
  const category = classification.category;
  const evidence: EvidenceItem[] = [];
  const notes: string[] = [];
  const add = (item: EvidenceItem) => {
    if (!evidence.some((e) => e.ref === item.ref)) evidence.push(item);
  };

  // --- Customer -----------------------------------------------------------
  if (request.customer_id) {
    const c = await tx.maybeOne<{ id: string; full_name: string; created_at: Date; open_tickets: number }>(
      `select c.id, c.full_name, c.created_at,
              (select count(*)::int from service_requests s where s.customer_id = c.id and s.status not in ('completed', 'cancelled')) as open_tickets
         from customers c where c.id = $1`,
      [request.customer_id],
    );
    if (c) {
      add({
        ref: `customer:${c.id}`,
        recordType: "customer",
        recordId: c.id,
        label: `Customer ${c.full_name}`,
        facts: { customer_id: c.id, name: c.full_name, customer_since: fmtDate(c.created_at, tz), open_service_tickets: c.open_tickets },
        matchReason: "Sender email matches this customer record",
      });
    }
  } else {
    notes.push("The sender's email does not match a customer record, so orders and service tickets cannot be looked up or confirmed.");
  }

  // --- Orders ---------------------------------------------------------------
  const wantsOrders = ["order_status", "return_refund"].includes(category) || Boolean(classification.extracted.order_number);
  if (wantsOrders && request.customer_id) {
    const orderNumber = classification.extracted.order_number?.toUpperCase().replace(/^SC(\d)/, "SC-$1") ?? null;
    const orders = await tx.many<{
      id: string;
      order_number: string;
      status: string;
      fulfillment: string;
      carrier: string | null;
      tracking_number: string | null;
      total_cents: number;
      placed_at: Date;
      expected_at: Date | null;
      delivered_at: Date | null;
      items: string | null;
    }>(
      `select o.id, o.order_number, o.status, o.fulfillment, o.carrier, o.tracking_number, o.total_cents,
              o.placed_at, o.expected_at, o.delivered_at,
              (select string_agg(p.name || ' x' || i.quantity, ', ' order by p.name)
                 from order_items i join products p on p.id = i.product_id where i.order_id = o.id) as items
         from orders o
        where o.customer_id = $1 and ($2::text is null or o.order_number = $2)
        order by o.placed_at desc limit 3`,
      [request.customer_id, orderNumber],
    );
    if (orderNumber && orders.length === 0) {
      notes.push(`Order ${orderNumber} was not found for this customer. Do not confirm details about it; ask the customer to check the number.`);
    }
    for (const o of orders) {
      const elig = returnEligibility(o, business.settings.return_window_days);
      add({
        ref: `order:${o.id}`,
        recordType: "order",
        recordId: o.id,
        label: `Order ${o.order_number}`,
        facts: {
          order_id: o.id,
          order_number: o.order_number,
          status: o.status,
          fulfillment: o.fulfillment,
          carrier: o.carrier,
          tracking_number: o.tracking_number,
          items: o.items,
          total: money(o.total_cents),
          total_cents: o.total_cents,
          placed_on: fmtDate(o.placed_at, tz),
          expected_on: fmtDate(o.expected_at, tz),
          delivered_on: fmtDate(o.delivered_at, tz),
          return_eligibility: elig.status,
          return_deadline: "deadline" in elig ? fmtDate(elig.deadline, tz) : null,
        },
        matchReason: orderNumber ? `Order number ${orderNumber} mentioned in the message` : "Recent order for this customer",
      });
    }
  } else if (wantsOrders && classification.extracted.order_number) {
    notes.push(`An order number was mentioned, but order details are only shared with the verified customer on the order.`);
  }

  // --- Products -------------------------------------------------------------
  const terms = searchTerms(classification);
  const wantsProducts = ["product_availability", "product_info"].includes(category) || terms.length > 0;
  if (wantsProducts && terms.length > 0) {
    const query = terms.join(" or ");
    const products = await tx.many<{
      id: string;
      sku: string;
      name: string;
      brand: string | null;
      category: string;
      description: string | null;
      price_cents: number;
      available: number;
      rank: number;
    }>(
      `select p.id, p.sku, p.name, p.brand, p.category, p.description, p.price_cents,
              coalesce((select sum(greatest(i.quantity_on_hand - i.quantity_reserved, 0))::int
                          from inventory_records i where i.product_id = p.id), 0) as available,
              ts_rank(p.search_vector, websearch_to_tsquery('english', $1))
                + greatest(similarity(p.name, $2), 0) as rank
         from products p
        where p.is_active
          and (p.search_vector @@ websearch_to_tsquery('english', $1) or similarity(p.name, $2) > 0.25)
        order by rank desc, p.name
        limit 5`,
      [query, terms.join(" ")],
    );
    for (const p of products) {
      add({
        ref: `product:${p.id}`,
        recordType: "product",
        recordId: p.id,
        label: `${p.name} (${p.sku})`,
        facts: {
          product_id: p.id,
          sku: p.sku,
          name: p.name,
          brand: p.brand,
          category: p.category,
          description: p.description ? p.description.slice(0, 300) : null,
          price: money(p.price_cents),
          price_cents: p.price_cents,
          available_quantity: p.available,
          stock_status: stockStatus(p.available),
        },
        matchReason: `Matched search terms: ${terms.slice(0, 4).join(", ")}`,
      });
    }
    if (products.length === 0) notes.push(`No products in the catalog matched: ${terms.slice(0, 4).join(", ")}.`);
  } else if (wantsProducts) {
    notes.push("The message does not name a specific product, so no catalog records were retrieved.");
  }

  // --- Service tickets ------------------------------------------------------
  if (["service_repair", "booking", "general_question"].includes(category) && request.customer_id) {
    const tickets = await tx.many<{
      id: string;
      ticket_number: string;
      status: string;
      bike_description: string;
      issue_summary: string;
      service_type: ServiceType;
      quoted_cents: number | null;
      updated_at: Date;
    }>(
      `select id, ticket_number, status, bike_description, issue_summary, service_type, quoted_cents, updated_at
         from service_requests
        where customer_id = $1 and (status not in ('completed', 'cancelled') or updated_at > now() - interval '30 days')
        order by updated_at desc limit 3`,
      [request.customer_id],
    );
    for (const t of tickets) {
      add({
        ref: `service_request:${t.id}`,
        recordType: "service_request",
        recordId: t.id,
        label: `Service ticket ${t.ticket_number}`,
        facts: {
          service_request_id: t.id,
          ticket_number: t.ticket_number,
          status: t.status,
          bike: t.bike_description,
          issue: t.issue_summary,
          service_type: SERVICE_TYPE_LABELS[t.service_type],
          quote: t.quoted_cents === null ? null : money(t.quoted_cents),
          last_updated: fmtDate(t.updated_at, tz),
        },
        matchReason: "Service ticket for this customer",
      });
    }
  }

  // --- Appointment availability --------------------------------------------
  if (["booking", "service_repair"].includes(category)) {
    const serviceType = classification.extracted.service_type ?? "tune_up";
    const timeframe = (classification.extracted.preferred_timeframe ?? "").toLowerCase();
    const weekday = Object.entries(WEEKDAYS).find(([name]) => timeframe.includes(name))?.[1] ?? null;
    const slots = await tx.many<{ id: string; starts_at: Date; ends_at: Date; service_type: string; technician_name: string | null; weekday: number }>(
      `select id, starts_at, ends_at, service_type, technician_name,
              extract(isodow from starts_at at time zone $3)::int as weekday
         from appointments
        where status = 'available' and starts_at > now() and starts_at < now() + interval '21 days'
          and (service_type = 'any' or service_type = $1)
        order by (extract(isodow from starts_at at time zone $3)::int = $2) desc nulls last, starts_at
        limit 4`,
      [serviceType, weekday, tz],
    );
    for (const s of slots) {
      add({
        ref: `appointment_slot:${s.id}`,
        recordType: "appointment_slot",
        recordId: s.id,
        label: `Open slot ${fmtDateTime(s.starts_at, tz)}`,
        facts: {
          appointment_slot_id: s.id,
          starts: fmtDateTime(s.starts_at, tz),
          ends: fmtDateTime(s.ends_at, tz),
          service_type: SERVICE_TYPE_LABELS[s.service_type as ServiceType | "any"] ?? s.service_type,
          technician: s.technician_name,
        },
        matchReason: weekday && s.weekday === weekday ? `Available on the requested day` : "Next available slot",
      });
    }
    if (slots.length === 0) notes.push("No appointment slots are open in the next three weeks for this service type.");
  }

  // --- Policies ---------------------------------------------------------------
  const policyCats = CATEGORY_POLICIES[category] ?? [];
  const policyText = terms.concat(classification.extracted.issue ? classification.extracted.issue.toLowerCase().split(/\W+/).filter((w) => w.length > 3) : []).slice(0, 8);
  const policies = await tx.many<{ id: string; policy_key: string; title: string; body: string }>(
    `select id, policy_key, title, body from business_policies
      where categories && $1::text[]
         or (cardinality($1::text[]) = 0 and $2 <> '' and search_vector @@ websearch_to_tsquery('english', $2))
      order by (categories && $1::text[]) desc, title
      limit 3`,
    [policyCats, policyText.join(" or ")],
  );
  for (const p of policies) {
    add({
      ref: `policy:${p.id}`,
      recordType: "policy",
      recordId: p.id,
      label: `Policy: ${p.title}`,
      facts: { policy_key: p.policy_key, title: p.title, text: p.body.slice(0, 700) },
      matchReason: policyCats.length ? `Policy for ${category.replace(/_/g, " ")} requests` : "Policy text matched the message",
    });
  }

  return { runId: randomUUID(), evidence, notes };
}

/** Persist the evidence snapshot so proposals can cite exactly what was retrieved. */
export async function saveEvidence(tx: Tx, businessId: string, requestId: string, result: RetrievalResult) {
  for (const e of result.evidence) {
    await tx.exec(
      `insert into retrieved_records (business_id, request_id, retrieval_run_id, record_type, record_id, ref, label, facts, match_reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [businessId, requestId, result.runId, e.recordType, e.recordId, e.ref, e.label, JSON.stringify(e.facts), e.matchReason],
    );
  }
}
