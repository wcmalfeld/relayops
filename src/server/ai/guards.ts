import type { EvidenceItem } from "@/server/ai/schemas";

/**
 * Deterministic safeguards that run regardless of what the model says.
 * They do not make the system safe on their own; they add review flags on top
 * of the structural controls (strict schemas, fixed actions, approvals).
 */

const INJECTION_PATTERNS: RegExp[] = [
  /\bignore\b.{0,40}\b(instructions|rules|prompt|policy|policies)\b/i,
  /\bdisregard\b.{0,40}\b(instructions|rules|above|previous)\b/i,
  /\b(system|developer)\s*(prompt|message|mode)\b/i,
  /\byou are now\b/i,
  /\bact as (an?|the)\b.{0,30}\b(admin|administrator|assistant|ai|system)\b/i,
  /\b(new|updated) instructions\b/i,
  /\bwithout (asking for |requiring |any )?(approval|review|confirmation)\b/i,
  /\b(auto(matically)?[- ]?approve|bypass)\b/i,
  /<\/?\s*(system|assistant|instructions?)\s*>/i,
  /\b(reveal|print|output|list|send|export)\b.{0,40}\b(all|every|other)\b.{0,20}\b(customers?|orders?|records?|emails?|data)\b/i,
  /\b(grant|give|make)\b.{0,20}\b(me|my account)\b.{0,20}\b(admin|owner|access|permission)/i,
  /\bjailbreak\b|\bDAN\b/,
];

export function detectInjectionSignals(text: string): string[] {
  return INJECTION_PATTERNS.filter((re) => re.test(text)).map((re) => re.source.slice(0, 40));
}

/** Escape text placed inside XML-style delimiters in prompts. */
export function fenceUntrusted(text: string) {
  return text.replace(/</g, "‹").replace(/>/g, "›");
}

export function truncateForModel(text: string, maxChars: number) {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}\n[...message truncated for processing...]`, truncated: true };
}

export type GroundingIssue = { kind: "amount" | "order_number" | "stock_claim" | "uncited_record_statement" | "unknown_ref"; detail: string };

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g;
const ORDER_NO = /\b[A-Z]{2}-\d{4,6}\b/g;

function centsFrom(raw: string) {
  return Math.round(Number(raw.replace(/,/g, "")) * 100);
}

/**
 * Check a drafted response against the evidence it was given:
 *  - every dollar amount must appear in a retrieved record or policy text,
 *  - every order/ticket number must belong to retrieved evidence,
 *  - "in stock" claims require a retrieved product with available stock,
 *  - statements marked as record-based must cite a retrieved record.
 */
export function checkGrounding(
  body: string,
  statements: { text: string; basis: string; evidence_refs: string[] }[],
  evidence: EvidenceItem[],
): GroundingIssue[] {
  const issues: GroundingIssue[] = [];
  const evidenceText = evidence.map((e) => `${e.label} ${Object.values(e.facts).join(" ")}`).join(" \n ");
  const knownAmounts = new Set<number>();
  for (const m of evidenceText.matchAll(MONEY)) knownAmounts.add(centsFrom(m[1]));
  for (const e of evidence) {
    for (const [k, v] of Object.entries(e.facts)) {
      if (typeof v === "number" && /cents$/.test(k)) knownAmounts.add(v);
    }
  }

  for (const m of body.matchAll(MONEY)) {
    const cents = centsFrom(m[1]);
    if (!knownAmounts.has(cents)) issues.push({ kind: "amount", detail: `Amount ${m[0].trim()} is not in any retrieved record` });
  }

  const knownIds = new Set([...evidenceText.matchAll(ORDER_NO)].map((m) => m[0]));
  for (const m of body.matchAll(ORDER_NO)) {
    if (!knownIds.has(m[0])) issues.push({ kind: "order_number", detail: `Reference ${m[0]} is not in any retrieved record` });
  }

  const claimsInStock = /\b(is|are|currently|now)\s+(in stock|available in store|on hand)\b/i.test(body) && !/\b(not|no longer|isn't|aren't)\s+(currently\s+)?(in stock|available)/i.test(body);
  if (claimsInStock) {
    const anyStock = evidence.some((e) => e.recordType === "product" && typeof e.facts.available_quantity === "number" && e.facts.available_quantity > 0);
    if (!anyStock) issues.push({ kind: "stock_claim", detail: "Draft says an item is in stock but no retrieved product has stock available" });
  }

  const refs = new Set(evidence.map((e) => e.ref));
  for (const s of statements) {
    if (s.basis === "record" && !s.evidence_refs.some((r) => refs.has(r))) {
      issues.push({ kind: "uncited_record_statement", detail: `Statement presented as fact has no supporting record: "${s.text.slice(0, 80)}"` });
    }
    for (const r of s.evidence_refs) {
      if (!refs.has(r)) issues.push({ kind: "unknown_ref", detail: `Statement cites an unknown record reference` });
    }
  }
  return dedupe(issues);
}

function dedupe(issues: GroundingIssue[]) {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.kind}:${i.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
