import { after, NextResponse, type NextRequest } from "next/server";
import { apiKeyContext } from "@/server/intake/channels";
import { createRequest } from "@/server/intake/intake-service";
import { processRequest } from "@/server/ai/pipeline";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { env } from "@/server/env";
import { errorSummary, toAppError } from "@/server/errors";

const MAX_BODY_BYTES = 32 * 1024;

/**
 * Intake API for integrations.
 *
 *   POST /api/v1/requests
 *   Authorization: Bearer ro_live_...
 *   { customer_name, customer_email?, customer_phone?, subject, body, received_at?, external_ref?, idempotency_key? }
 *
 * The API key determines the business. A business id in the payload is
 * rejected as an unknown field.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await apiKeyContext(request.headers.get("authorization"));
    if (!ctx) return json(401, { error: { code: "unauthenticated", message: "Missing or invalid API key." } });

    await enforceRateLimit(`api:${ctx.businessId}`, env().API_INTAKE_PER_MINUTE, 60, "Rate limit exceeded. Retry in a minute.");

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return json(415, { error: { code: "validation", message: "Send JSON with Content-Type: application/json." } });
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: { code: "validation", message: "Payload too large." } });
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json(400, { error: { code: "validation", message: "Body is not valid JSON." } });
    }

    const created = await createRequest(ctx, payload, "api");
    if (created.autoProcess) {
      after(async () => {
        try {
          await processRequest({ ...ctx }, created.id);
        } catch (err) {
          console.error("[relayops] background processing failed", errorSummary(err));
        }
      });
    }
    return json(created.duplicate ? 200 : 201, { id: created.id, reference: created.reference, duplicate: created.duplicate, processing: created.autoProcess });
  } catch (err) {
    const e = toAppError(err);
    if (e.code === "internal") console.error("[relayops] intake API error", errorSummary(err));
    return json(e.status, { error: { code: e.code, message: e.message, ...(e.details ? { fields: e.details } : {}) } });
  }
}

export function GET() {
  return json(405, { error: { code: "validation", message: "Use POST." } });
}

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

