import { z } from "zod";

export const businessSettingsSchema = z.object({
  public_intake_enabled: z.boolean().default(false),
  member_request_visibility: z.enum(["assigned_and_unassigned", "all"]).default("assigned_and_unassigned"),
  medium_risk_requires_approval: z.boolean().default(false),
  /** Minimum completed requests before averages are shown as measured values. */
  min_sample_for_metrics: z.number().int().min(1).max(1000).default(5),
  response_sign_off: z.string().trim().max(120).default("The team"),
  /** Deterministic return-eligibility window used by policy checks. */
  return_window_days: z.number().int().min(0).max(365).default(30),
});

export type BusinessSettings = z.infer<typeof businessSettingsSchema>;

export function parseSettings(raw: unknown): BusinessSettings {
  const parsed = businessSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : businessSettingsSchema.parse({});
}

export const settingsFormSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  support_email: z.union([z.email().max(254), z.literal("")]),
  timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, "Unknown time zone"),
  public_intake_enabled: z.boolean(),
  member_request_visibility: z.enum(["assigned_and_unassigned", "all"]),
  medium_risk_requires_approval: z.boolean(),
  min_sample_for_metrics: z.coerce.number().int().min(1).max(1000),
  response_sign_off: z.string().trim().min(1).max(120),
  return_window_days: z.coerce.number().int().min(0).max(365),
});

export const categoryUpdateSchema = z.strictObject({
  id: z.uuid(),
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300),
  is_enabled: z.boolean(),
  baseline_manual_minutes: z.coerce.number().min(0).max(600),
  assisted_minutes: z.coerce.number().min(0).max(600),
});

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
