import { z } from "zod";

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/**
 * The single request-creation contract shared by every channel: the manual
 * form, demo scenarios, the public form and the HTTP intake API. Future
 * integrations (email, e-commerce, POS) map their payloads to this shape.
 */
export const intakeSchema = z.strictObject({
  customer_name: z.string().trim().min(1, "Customer name is required.").max(120),
  customer_email: z
    .union([z.email("Enter a valid email address.").max(254), z.literal("")])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined)),
  customer_phone: optionalTrimmed(40).refine((v) => !v || /^[0-9+().\-\s]{7,40}$/.test(v), "Enter a valid phone number."),
  subject: z.string().trim().min(1, "Subject is required.").max(200),
  body: z.string().trim().min(1, "Message is required.").max(8000, "Message is too long (8,000 characters max)."),
  received_at: z.iso.datetime({ offset: true }).optional(),
  external_ref: optionalTrimmed(120),
  idempotency_key: optionalTrimmed(120).refine((v) => !v || /^[A-Za-z0-9._:-]+$/.test(v), "Invalid idempotency key."),
});

export type IntakeInput = z.input<typeof intakeSchema>;
export type ValidIntake = z.output<typeof intakeSchema>;

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
