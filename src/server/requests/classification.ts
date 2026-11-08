import "server-only";
import { z } from "zod";
import { withTenant } from "@/server/db/tenant";
import type { UserContext } from "@/server/auth/types";
import { assertCan } from "@/server/auth/permissions";
import { recordAudit } from "@/server/audit/audit";
import { invalid, notFound } from "@/server/errors";

export const correctionSchema = z.strictObject({
  request_id: z.uuid(),
  category: z.string().trim().regex(/^[a-z0-9_]{2,48}$/),
  summary: z.string().trim().min(1).max(1000),
  reason: z.string().trim().min(1, "Say briefly why you are correcting it.").max(300),
});

/**
 * Record a human correction as a new classification row. The model's
 * original output is kept unchanged and remains visible in the history.
 */
export async function correctClassification(ctx: UserContext, input: unknown) {
  assertCan(ctx, "requests.correct_classification");
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid correction.");
  const d = parsed.data;
  return withTenant(ctx, async (tx) => {
    const req = await tx.maybeOne<{ category: string | null }>("select category from customer_requests where id = $1 for update", [d.request_id]);
    if (!req) throw notFound("Request not found.");
    const cat = await tx.maybeOne("select 1 from request_categories where key = $1 and is_enabled", [d.category]);
    if (!cat) throw invalid("Unknown category.");

    const current = await tx.maybeOne<{ id: string; summary: string; extracted_fields: unknown; missing_information: unknown; key_points: unknown }>(
      "select id, summary, extracted_fields, missing_information, key_points from request_classifications where request_id = $1 and is_current for update",
      [d.request_id],
    );
    await tx.exec("update request_classifications set is_current = false where request_id = $1 and is_current", [d.request_id]);
    const row = await tx.one<{ id: string }>(
      `insert into request_classifications
         (business_id, request_id, source, category, summary, key_points, extracted_fields, missing_information, supersedes_id, correction_reason, created_by)
       values ($1, $2, 'human', $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [
        ctx.businessId,
        d.request_id,
        d.category,
        d.summary,
        JSON.stringify(current?.key_points ?? []),
        JSON.stringify(current?.extracted_fields ?? {}),
        JSON.stringify(current?.missing_information ?? []),
        current?.id ?? null,
        d.reason,
        ctx.userId,
      ],
    );
    await tx.exec("update customer_requests set category = $2 where id = $1", [d.request_id, d.category]);
    await recordAudit(tx, ctx, {
      eventType: "classification.corrected",
      result: "success",
      requestId: d.request_id,
      entityType: "request_classification",
      entityId: row.id,
      metadata: { from_category: req.category, to_category: d.category, summary_changed: current?.summary !== d.summary, supersedes: current?.id ?? null },
    });
  });
}
