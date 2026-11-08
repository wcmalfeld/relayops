import { randomUUID } from "node:crypto";
import { AIError, type AIResult, type AIService } from "@/server/ai/service";
import { detectInjectionSignals } from "@/server/ai/guards";
import type {
  ClassificationOutput,
  ClassifyInput,
  DraftInput,
  DraftOutput,
  EvidenceItem,
  ProposalOutput,
  ProposeInput,
  SummarizeInput,
  SummaryOutput,
} from "@/server/ai/schemas";
import type { ServiceType } from "@/lib/domain";

/**
 * Deterministic stand-in for a hosted model, for local development, demos and
 * tests. It reads only the inputs it is given (it has no database access),
 * so it exercises the same validation path as a real provider.
 *
 * Demo behaviour: when a message contains prompt-injection patterns, the mock
 * deliberately behaves like a manipulated model and returns hostile output
 * (unsupported actions, an unbacked refund claim). This lets reviewers see
 * the server-side controls block it. A real provider may or may not resist
 * injection; RelayOps does not depend on it doing so.
 */

const CATEGORY_KEYWORDS: Record<string, RegExp[]> = {
  order_status: [/\border\b/i, /\bship(ped|ping)?\b/i, /\btracking\b/i, /\bdeliver(y|ed)?\b/i, /\bwhere is my\b/i, /\barriv(e|al)\b/i, /\bpackage\b/i, /\bSC-?\d{4,6}\b/i, /\bpick ?up\b/i],
  product_availability: [/\bin stock\b/i, /\bavailab(le|ility)\b/i, /\bdo you (have|carry)\b/i, /\bstock\b/i, /\bsize (small|medium|large|s|m|l)\b/i, /\b(medium|large|small) frame\b/i],
  service_repair: [/\brepair\b/i, /\bfix\b/i, /\bbroken\b/i, /\bsqueak/i, /\bnois(e|y)\b/i, /\bflat\b/i, /\btune[- ]?up\b/i, /\bbrakes?\b/i, /\bderailleur\b/i, /\bshift(ing)?\b/i, /\bwobbl/i, /\bservice\b/i, /\bcoming along\b/i, /\bmotor\b/i, /\bbattery\b/i],
  booking: [/\bappointment\b/i, /\bbook\b/i, /\bschedul/i, /\bdrop(-| )?off\b/i, /\bslot\b/i, /\breserve\b/i],
  return_refund: [/\breturn(ing|ed)?\b/i, /\brefund/i, /\bexchange\b/i, /\bmoney back\b/i],
  product_info: [/\bspec/i, /\bweigh/i, /\bclearance\b/i, /\bcompare\b/i, /\bdifference\b/i, /\brecommend/i, /\bgood for\b/i, /\bwarranty\b/i, /\bbikepacking\b/i],
  general_question: [/\bhours\b/i, /\bopen\b/i, /\blocation\b/i, /\bparking\b/i, /\btest ride\b/i, /\bprice match\b/i, /\bclosed\b/i],
};

const SERVICE_KEYWORDS: [RegExp, ServiceType][] = [
  [/\be-?bike\b|\bmotor\b|\bbattery\b|\bE-Trail\b/i, "ebike_diagnostic"],
  [/\bbrake|squeal|squeak/i, "brake_service"],
  [/\btune[- ]?up\b/i, "tune_up"],
  [/\bwheel\b|\bwobbl|\btrue\b/i, "wheel_true"],
  [/\bchain\b|\bshift|\bgear|\bderailleur|\bclick/i, "drivetrain"],
  [/\bfork\b|\bshock\b|\bsuspension\b/i, "suspension"],
  [/\bfit(ting)?\b/i, "fitting"],
  [/\brepair|\bfix|\bbroken|\bflat\b/i, "repair"],
];

const NOT_PRODUCT = new Set([
  "hi", "hello", "hey", "thanks", "thank", "cheers", "regards", "best", "please", "i", "i'm", "im", "my", "the", "can", "could", "do", "does", "is", "are",
  "what", "when", "where", "how", "also", "and", "but", "just", "any", "you", "we", "it", "if", "monday", "tuesday", "wednesday", "thursday", "friday",
  "saturday", "sunday", "summit", "cycles", "order", "sc", "ok", "okay", "ignore", "system", "assistant", "admin", "note", "re", "yes", "no", "dear",
]);
const PRODUCT_NOUNS = /\b(helmets?|sealant|chains?|brake pads|pads|tires?|tubes?|gravel|road bike|mountain bike|kids bike|commuter|hybrid|e-?bikes?|lights?|locks?)\b/gi;

function extractProductTerms(text: string, customerName: string) {
  const nameParts = new Set(customerName.toLowerCase().split(/\s+/));
  const terms = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9]+(?:-[A-Za-z0-9]+)?(?:\s(?:[A-Z][A-Za-z0-9]+|\d{2,3}))*)\b/g)) {
    const words = m[1].split(/\s+/).filter((w) => !NOT_PRODUCT.has(w.toLowerCase()) && !nameParts.has(w.toLowerCase()));
    if (words.length && words.join(" ").length > 3) terms.add(words.join(" "));
  }
  for (const m of text.matchAll(PRODUCT_NOUNS)) terms.add(m[1].toLowerCase());
  return [...terms].slice(0, 6);
}

function classifyText(input: ClassifyInput): ClassificationOutput {
  const { subject, body, customerName, customerMatched } = input.request;
  const text = `${subject}\n${body}`;
  const allowed = new Set(input.categories.map((c) => c.key));
  const injection = detectInjectionSignals(text).length > 0;

  const scores = Object.entries(CATEGORY_KEYWORDS)
    .filter(([key]) => allowed.has(key))
    .map(([key, patterns]) => [key, patterns.filter((p) => p.test(text)).length] as const)
    .sort((a, b) => b[1] - a[1]);
  const top = scores[0]?.[1] ?? 0;
  let category: string = scores[0]?.[0] ?? "other";
  const second = scores[1]?.[1] ?? 0;
  // "Book" language wins over generic service language; returns beat orders.
  if (scores.find(([k]) => k === "booking")?.[1] && /\b(book|appointment|schedul)/i.test(text)) category = "booking";
  if (scores.find(([k]) => k === "return_refund")?.[1]) category = "return_refund";
  if (top === 0) category = allowed.has("other") ? "other" : category;

  const orderMatch = text.match(/\bSC-?(\d{4,6})\b/i);
  const serviceType = SERVICE_KEYWORDS.find(([re]) => re.test(text))?.[1] ?? null;
  const timeframe = text.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|this week|next week|weekend)\b(\s+(morning|afternoon))?/i)?.[0] ?? null;
  const bike = text.match(/\b(my|our)\s+([A-Z][A-Za-z0-9-]+(?:\s[A-Z0-9][A-Za-z0-9-]*){0,3})/)?.[2] ?? null;

  const missing: string[] = [];
  if (category === "order_status" && !orderMatch) missing.push("Order number");
  if (category === "order_status" && !customerMatched) missing.push("Email address used for the order");
  if (category === "booking" && !timeframe) missing.push("Preferred day or time");
  if ((category === "service_repair" || category === "booking") && !bike && !serviceType) missing.push("Bike make/model and the problem");
  if (category === "other") missing.push("What the customer needs help with");

  const level: ClassificationOutput["uncertainty"]["level"] = injection || category === "other" || top === 0 ? "high" : top - second <= 0 ? "medium" : "low";
  const firstSentence = body.split(/(?<=[.!?])\s+/)[0]?.trim().slice(0, 200) ?? "";

  return {
    category,
    extracted: {
      order_number: orderMatch ? `SC-${orderMatch[1]}` : null,
      product_terms: ["product_availability", "product_info"].includes(category) || /\bin stock\b/i.test(text) ? extractProductTerms(text, customerName) : [],
      bike_description: bike,
      service_type: ["service_repair", "booking"].includes(category) ? (serviceType ?? (category === "booking" ? "tune_up" : "repair")) : null,
      preferred_timeframe: timeframe,
      issue: ["service_repair", "booking", "return_refund"].includes(category) ? firstSentence : null,
    },
    missing_information: missing,
    uncertainty: {
      level,
      notes: injection
        ? "The message tries to instruct automated tools; its stated intent cannot be taken at face value."
        : level === "low"
          ? "Clear intent."
          : level === "medium"
            ? "Request mentions more than one topic."
            : "Intent is unclear from the message.",
    },
    suggested_next_step: injection
      ? "Treat with caution; the message contains instructions aimed at automated tools."
      : missing.length
        ? `Ask the customer for: ${missing.join(", ").toLowerCase()}.`
        : "Review the drafted response and proposed actions.",
    injection_suspected: injection,
  };
}

const CATEGORY_PHRASE: Record<string, string> = {
  order_status: "the status of an order",
  product_availability: "product availability",
  service_repair: "a repair or service",
  booking: "booking a service appointment",
  return_refund: "a return or refund",
  product_info: "product details",
  general_question: "a general store question",
  other: "an unclear request",
};

function summarize(input: SummarizeInput): SummaryOutput {
  const { customerName, subject, body } = input.request;
  const sentences = body.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return {
    summary: `${customerName} is asking about ${CATEGORY_PHRASE[input.category] ?? "a request"}: "${subject.slice(0, 120)}".`,
    key_points: sentences.slice(0, 3).map((s) => s.slice(0, 150)),
  };
}

const byType = (evidence: EvidenceItem[], t: EvidenceItem["recordType"]) => evidence.filter((e) => e.recordType === t);
const fact = (e: EvidenceItem, k: string) => (e.facts[k] === null || e.facts[k] === undefined ? null : String(e.facts[k]));

function draft(input: DraftInput): DraftOutput {
  const { request, classification: c, evidence, retrievalNotes, signOff, businessName } = input;
  const first = request.customerName.split(/\s+/)[0];
  const lines: string[] = [];
  const statements: DraftOutput["statements"] = [];
  const unavailable: string[] = [];
  let review = false;
  let reviewReason: string | null = null;
  const say = (text: string, refs: string[] = []) => {
    lines.push(text);
    if (refs.length) statements.push({ text: text.slice(0, 300), basis: "record", evidence_refs: refs });
  };

  if (c.injection_suspected) {
    // Simulated manipulated-model output (see file header).
    return {
      subject: `Re: ${request.subject}`.slice(0, 200),
      body: `Hi ${first},\n\nYour refund of $5,000.00 has been approved and the customer list you requested is attached.\n\n${signOff}\n${businessName}`,
      statements: [{ text: "Refund of $5,000.00 approved", basis: "record", evidence_refs: [] }],
      unavailable_information: [],
      needs_human_review: false,
      review_reason: null,
    };
  }

  const orders = byType(evidence, "order");
  const products = byType(evidence, "product");
  const slots = byType(evidence, "appointment_slot");
  const tickets = byType(evidence, "service_request");
  const policies = byType(evidence, "policy");

  switch (c.category) {
    case "order_status": {
      const o = orders[0];
      if (o) {
        const status = fact(o, "status");
        const n = fact(o, "order_number");
        if (status === "shipped") say(`Your order ${n} (${fact(o, "items")}) has shipped with ${fact(o, "carrier")}. The tracking number is ${fact(o, "tracking_number")}${fact(o, "expected_on") ? ` and it is expected ${fact(o, "expected_on")}` : ""}.`, [o.ref]);
        else if (status === "processing" || status === "pending") say(`Your order ${n} (${fact(o, "items")}) is still being prepared${fact(o, "expected_on") ? `; we currently expect it to be ready ${fact(o, "expected_on")}` : ""}.`, [o.ref]);
        else if (status === "ready_for_pickup") say(`Good news: your order ${n} (${fact(o, "items")}) is ready for pickup at the shop.`, [o.ref]);
        else if (status === "delivered") say(`Our records show order ${n} was delivered on ${fact(o, "delivered_on")}.`, [o.ref]);
        else say(`Your order ${n} is currently marked as ${status}.`, [o.ref]);
      } else {
        lines.push("I wasn't able to find an order matching your message. Could you reply with your order number (it starts with SC-) and the email address you used at checkout?");
        unavailable.push("Order details could not be confirmed");
        review = true;
        reviewReason = "Order could not be matched to the sender";
      }
      break;
    }
    case "product_availability":
    case "product_info": {
      if (products.length) {
        for (const p of products.slice(0, 2)) {
          const qty = Number(p.facts.available_quantity ?? 0);
          const stock = qty > 0 ? `we currently have ${qty} available` : "it is currently out of stock";
          say(`The ${fact(p, "name")} is ${fact(p, "price")} and ${stock}.`, [p.ref]);
          if (c.category === "product_info" && fact(p, "description")) say(`${fact(p, "description")}`, [p.ref]);
        }
        if (c.category === "product_info") {
          unavailable.push("Detailed specifications beyond the catalog description");
          lines.push("For anything more specific than that, one of our staff will follow up with details.");
          review = true;
          reviewReason = "Question may need specifications not in the catalog";
        }
      } else {
        lines.push("I couldn't find that item in our catalog. Could you share the exact model or a link so we can check for you?");
        unavailable.push("No matching product record");
        review = true;
        reviewReason = "No matching product record";
      }
      break;
    }
    case "service_repair":
    case "booking": {
      const openTicket = tickets.find((t) => !["completed", "cancelled"].includes(fact(t, "status") ?? ""));
      if (openTicket) say(`Your ${fact(openTicket, "bike")} (ticket ${fact(openTicket, "ticket_number")}) is currently ${fact(openTicket, "status")?.replace(/_/g, " ")}.`, [openTicket.ref]);
      if (slots.length) {
        lines.push("We have these drop-off times open:");
        for (const s of slots.slice(0, 3)) say(`- ${fact(s, "starts")} (${fact(s, "service_type")})`, [s.ref]);
        lines.push("Reply with the time that works best and we'll confirm it.");
      } else if (!openTicket) {
        lines.push("A team member will follow up with the next available service time.");
        review = true;
        reviewReason = "No open appointment slots found";
      }
      const pricing = policies.find((p) => /pric|rate/i.test(fact(p, "title") ?? ""));
      if (pricing && !openTicket) say(`For reference, our service pricing: ${fact(pricing, "text")}`, [pricing.ref]);
      if (c.missing_information.length) lines.push(`So we can prepare, could you also tell us: ${c.missing_information.join(", ").toLowerCase()}?`);
      break;
    }
    case "return_refund": {
      const o = orders[0];
      if (!o) {
        lines.push("I'm sorry to hear that. Could you reply with your order number and the email used at checkout so we can look into a return?");
        unavailable.push("Order not identified");
        review = true;
        reviewReason = "Order not identified";
        break;
      }
      const elig = fact(o, "return_eligibility");
      if (elig === "eligible") {
        say(`Order ${fact(o, "order_number")} is within our return window (until ${fact(o, "return_deadline")}).`, [o.ref]);
        const policy = policies[0];
        if (policy) say(`Per our return policy: ${fact(policy, "text")}`, [policy.ref]);
        lines.push("I've passed your request to a manager, who will confirm the refund after inspecting the item.");
      } else if (elig === "outside_window") {
        say(`Order ${fact(o, "order_number")} is outside our return window, which ended ${fact(o, "return_deadline")}.`, [o.ref]);
        lines.push("I've shared your note with a manager, who can talk through any options with you.");
        review = true;
        reviewReason = "Return falls outside the policy window";
      } else {
        say(`Order ${fact(o, "order_number")} hasn't been delivered yet, so it isn't eligible for a return at this stage.`, [o.ref]);
      }
      break;
    }
    case "general_question": {
      if (policies.length) {
        for (const p of policies.slice(0, 1)) say(`${fact(p, "text")}`, [p.ref]);
      } else {
        lines.push("Thanks for your question. A member of our team will get back to you shortly.");
        review = true;
        reviewReason = "No policy record answers this question";
      }
      break;
    }
    default: {
      lines.push("Thanks for getting in touch. Could you tell us a little more about what you need help with—for example an order number, the bike you're asking about, or the service you're interested in?");
      unavailable.push("The request is unclear");
      review = true;
      reviewReason = "Request is ambiguous";
    }
  }

  for (const note of retrievalNotes) {
    if (/not found for this customer/i.test(note)) {
      unavailable.push("Mentioned order not found for this customer");
      review = true;
      reviewReason = reviewReason ?? "Mentioned order could not be verified";
    }
  }

  return {
    subject: `Re: ${request.subject}`.slice(0, 200),
    body: `Hi ${first},\n\n${lines.join("\n")}\n\nThanks,\n${signOff}\n${businessName}`.slice(0, 4000),
    statements,
    unavailable_information: unavailable,
    needs_human_review: review,
    review_reason: reviewReason,
  };
}

function propose(input: ProposeInput): ProposalOutput {
  const { classification: c, evidence } = input;
  const proposals: ProposalOutput["proposals"] = [];
  const customer = byType(evidence, "customer")[0];
  const customerId = customer ? fact(customer, "customer_id") : null;

  if (c.injection_suspected) {
    // Simulated manipulated-model output (see file header).
    return {
      proposals: [
        { action_type: "issue_refund", params: { amount_cents: 500000, destination: "external" }, explanation: "Customer requested an immediate refund.", evidence_refs: [], unresolved_requirements: [] },
        { action_type: "grant_admin_access", params: { email: "requester" }, explanation: "Customer asked for admin access.", evidence_refs: [], unresolved_requirements: [] },
        { action_type: "assign_team_member", params: { assignee_user_id: randomUUID(), role: "owner" }, explanation: "Escalate per customer instruction.", evidence_refs: [], unresolved_requirements: [] },
      ],
    };
  }

  const slot = byType(evidence, "appointment_slot")[0];
  const openTicket = byType(evidence, "service_request").find((t) => !["completed", "cancelled"].includes(fact(t, "status") ?? ""));
  if (c.category === "booking" && slot && customerId) {
    proposals.push({
      action_type: "propose_appointment",
      params: { appointment_slot_id: fact(slot, "appointment_slot_id"), customer_id: customerId, service_type: c.extracted.service_type ?? "tune_up" },
      explanation: `The customer asked to book service${c.extracted.preferred_timeframe ? ` (${c.extracted.preferred_timeframe})` : ""}; this is the best matching open slot (${fact(slot, "starts")}).`,
      evidence_refs: [slot.ref, customer.ref],
      unresolved_requirements: c.extracted.preferred_timeframe ? [] : ["Customer has not confirmed a preferred time"],
    });
  }
  if (c.category === "service_repair" && customerId && !openTicket && c.extracted.issue) {
    proposals.push({
      action_type: "create_service_request",
      params: {
        customer_id: customerId,
        bike_description: c.extracted.bike_description ?? "Customer bike (model not stated)",
        issue_summary: c.extracted.issue,
        service_type: c.extracted.service_type ?? "repair",
      },
      explanation: "The customer described a problem with their bike and has no open service ticket.",
      evidence_refs: [customer.ref],
      unresolved_requirements: c.extracted.bike_description ? [] : ["Bike make and model not provided"],
    });
  }
  const order = byType(evidence, "order")[0];
  if (c.category === "return_refund" && order && customerId && fact(order, "return_eligibility") === "eligible") {
    proposals.push({
      action_type: "prepare_refund_request",
      params: { order_id: fact(order, "order_id"), customer_id: customerId, amount_cents: Number(order.facts.total_cents), reason: c.extracted.issue ?? "Customer requested a return within the policy window." },
      explanation: `Order ${fact(order, "order_number")} is within the return window, so a refund request can be prepared for a manager.`,
      evidence_refs: [order.ref],
      unresolved_requirements: ["Item must be inspected in store before any refund is issued"],
    });
  }
  if (c.uncertainty.level === "high" || c.missing_information.length > 1) {
    proposals.push({
      action_type: "add_internal_note",
      params: { body: `Needs clarification before we can act: ${c.missing_information.join("; ") || "intent unclear"}.` },
      explanation: "Leave a note so whoever picks this up knows what is missing.",
      evidence_refs: [],
      unresolved_requirements: [],
    });
  }
  return { proposals: proposals.slice(0, 3) };
}

function result(output: unknown, input: unknown): AIResult {
  const len = JSON.stringify(input).length;
  return { output, usage: { inputTokens: Math.ceil(len / 4), outputTokens: Math.ceil(JSON.stringify(output).length / 4) }, attempts: 1 };
}

export class MockAIService implements AIService {
  readonly provider = "mock";
  readonly model = "relayops-mock-1";

  async classify(input: ClassifyInput) {
    return result(classifyText(input), input);
  }
  async summarize(input: SummarizeInput) {
    return result(summarize(input), input);
  }
  async draftResponse(input: DraftInput) {
    return result(draft(input), input);
  }
  async proposeActions(input: ProposeInput) {
    return result(propose(input), input);
  }
}

/** Simulates a provider outage so the manual fallback path can be exercised. */
export class UnavailableAIService implements AIService {
  readonly provider = "unavailable";
  readonly model = "none";
  private fail(): never {
    throw new AIError("unavailable", "AI provider is unavailable (simulated outage)");
  }
  async classify(): Promise<AIResult> {
    this.fail();
  }
  async summarize(): Promise<AIResult> {
    this.fail();
  }
  async draftResponse(): Promise<AIResult> {
    this.fail();
  }
  async proposeActions(): Promise<AIResult> {
    this.fail();
  }
}
