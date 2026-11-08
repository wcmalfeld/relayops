import "server-only";
import { withTenant } from "@/server/db/tenant";
import type { ActorContext } from "@/server/auth/types";
import { assertCan } from "@/server/auth/permissions";
import { recordAudit } from "@/server/audit/audit";
import { AppError } from "@/server/errors";
import { fieldErrors, intakeSchema } from "@/server/intake/schemas";
import { runRequestCreatedRules } from "@/server/rules/engine";
import type { RequestChannel } from "@/lib/domain";

export type CreatedRequest = {
  id: string;
  reference: string;
  duplicate: boolean;
  /** True when an enabled rule asks for AI processing right after intake. */
  autoProcess: boolean;
};

/**
 * Common request-creation interface. Every channel calls this function with a
 * server-built actor context; the business comes from that context, never
 * from the payload.
 */
export async function createRequest(
  ctx: ActorContext,
  input: unknown,
  channel: RequestChannel,
  options: { isDemo?: boolean } = {},
): Promise<CreatedRequest> {
  if (ctx.kind === "user") assertCan(ctx, "requests.create");
  if (ctx.kind === "system" && !(["public_intake", "api_intake"] as const).includes(ctx.source as "public_intake")) {
    throw new AppError("forbidden", "This process cannot create requests.");
  }

  const parsed = intakeSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("validation", "Please correct the highlighted fields.", fieldErrors(parsed.error));
  }
  const data = parsed.data;

  // Back-dating is only meaningful for imports; never allow future timestamps.
  const receivedAt = data.received_at ? new Date(data.received_at) : new Date();
  if (receivedAt.getTime() > Date.now() + 5 * 60_000) {
    throw new AppError("validation", "received_at cannot be in the future.", { received_at: "Cannot be in the future." });
  }

  return withTenant(ctx, async (tx) => {
    if (data.idempotency_key) {
      const existing = await tx.maybeOne<{ id: string; reference: string }>(
        "select id, reference from customer_requests where idempotency_key = $1",
        [data.idempotency_key],
      );
      if (existing) return { ...existing, duplicate: true, autoProcess: false };
    }

    // Link to a known customer only by exact email match inside this business.
    const customer = data.customer_email
      ? await tx.maybeOne<{ id: string }>("select id from customers where lower(email) = $1", [data.customer_email])
      : null;

    const row = await tx.one<{ id: string; reference: string }>(
      `insert into customer_requests
         (business_id, customer_id, customer_name, customer_email, customer_phone, channel, subject, body,
          received_at, external_ref, idempotency_key, is_demo, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning id, reference`,
      [
        ctx.businessId,
        customer?.id ?? null,
        data.customer_name,
        data.customer_email ?? null,
        data.customer_phone ?? null,
        channel,
        data.subject,
        data.body,
        receivedAt,
        data.external_ref ?? null,
        data.idempotency_key ?? null,
        options.isDemo ?? false,
        ctx.kind === "user" ? ctx.userId : null,
      ],
    );

    await recordAudit(tx, ctx, {
      eventType: "request.created",
      result: "success",
      actorType: ctx.kind === "user" ? "user" : channel === "public_form" ? "public" : "system",
      requestId: row.id,
      entityType: "customer_request",
      entityId: row.id,
      metadata: {
        channel,
        reference: row.reference,
        matched_customer: Boolean(customer),
        body_length: data.body.length,
        has_contact_email: Boolean(data.customer_email),
      },
    });

    const effects = await runRequestCreatedRules(tx, ctx, row.id);
    return { ...row, duplicate: false, autoProcess: effects.processWithAi };
  });
}
