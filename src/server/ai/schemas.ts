import { z } from "zod";
import { SERVICE_TYPES } from "@/lib/domain";

/**
 * Structured outputs the server accepts from any AI provider. Providers return
 * `unknown`; these schemas are the only way model output enters the system.
 * Objects are strict: unexpected keys are rejected, not ignored.
 */

const short = (max: number) => z.string().trim().max(max);

export const classificationOutputSchema = z.strictObject({
  category: short(48).min(1),
  extracted: z.strictObject({
    order_number: short(40).nullable(),
    product_terms: z.array(short(60).min(1)).max(8),
    bike_description: short(200).nullable(),
    service_type: z.enum(SERVICE_TYPES).nullable(),
    preferred_timeframe: short(120).nullable(),
    issue: short(300).nullable(),
  }),
  missing_information: z.array(short(160).min(1)).max(6),
  uncertainty: z.strictObject({
    level: z.enum(["low", "medium", "high"]),
    notes: short(300),
  }),
  suggested_next_step: short(240).min(1),
  injection_suspected: z.boolean(),
});
export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;

export const summaryOutputSchema = z.strictObject({
  summary: short(400).min(1),
  key_points: z.array(short(160).min(1)).max(5),
});
export type SummaryOutput = z.infer<typeof summaryOutputSchema>;

export const draftOutputSchema = z.strictObject({
  subject: short(200).min(1),
  body: short(4000).min(1),
  statements: z
    .array(
      z.strictObject({
        text: short(300).min(1),
        basis: z.enum(["record", "customer", "assumption"]),
        evidence_refs: z.array(short(80)).max(6),
      }),
    )
    .max(12),
  unavailable_information: z.array(short(200).min(1)).max(6),
  needs_human_review: z.boolean(),
  review_reason: short(300).nullable(),
});
export type DraftOutput = z.infer<typeof draftOutputSchema>;

export const proposalOutputSchema = z.strictObject({
  proposals: z
    .array(
      z.strictObject({
        // A free string on purpose: an unsupported action must reach the
        // policy check so it can be refused and audited, not silently dropped.
        action_type: short(64).min(1),
        params: z.record(z.string(), z.unknown()),
        explanation: short(600).min(1),
        evidence_refs: z.array(short(80)).max(8),
        unresolved_requirements: z.array(short(200)).max(6),
      }),
    )
    .max(5),
});
export type ProposalOutput = z.infer<typeof proposalOutputSchema>;

// ---------------------------------------------------------------------------
// Inputs (built by the server, never by the client)
// ---------------------------------------------------------------------------

export type CategoryOption = { key: string; label: string; description: string };

export type RequestText = {
  reference: string;
  subject: string;
  body: string;
  customerName: string;
  customerMatched: boolean;
  receivedAt: string;
};

export type EvidenceItem = {
  ref: string;
  recordType: "customer" | "product" | "order" | "service_request" | "appointment_slot" | "policy";
  recordId: string;
  label: string;
  facts: Record<string, string | number | boolean | null>;
  matchReason: string;
};

export type ClassifyInput = { request: RequestText; categories: CategoryOption[] };
export type SummarizeInput = { request: RequestText; category: string };
export type DraftInput = {
  request: RequestText;
  classification: ClassificationOutput;
  evidence: EvidenceItem[];
  retrievalNotes: string[];
  businessName: string;
  signOff: string;
};
export type ProposeInput = {
  request: RequestText;
  classification: ClassificationOutput;
  evidence: EvidenceItem[];
  retrievalNotes: string[];
  allowedActions: { type: string; description: string; params_schema: unknown }[];
  teamMembers: { user_id: string; name: string; title: string | null }[];
};
