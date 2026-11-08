"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { publicIntakeContext } from "@/server/intake/channels";
import { createRequest } from "@/server/intake/intake-service";
import { processRequest } from "@/server/ai/pipeline";
import { enforceRateLimit } from "@/server/http/rate-limit";
import { secretHash } from "@/server/auth/tokens";
import { env } from "@/server/env";
import { AppError, errorSummary, runAction } from "@/server/errors";

export async function submitPublicRequest(slug: string, input: Record<string, string>) {
  return runAction(async () => {
    const resolved = await publicIntakeContext(slug);
    if (!resolved) throw new AppError("not_found", "This business is not accepting online requests.");

    // Honeypot: real visitors never see or fill this field.
    if (input.website) return { reference: null as string | null };

    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
    await enforceRateLimit(`public:${resolved.ctx.businessId}:${secretHash(ip, "ip")}`, env().PUBLIC_INTAKE_PER_HOUR, 3600, "You have sent several requests recently. Please wait a while before sending another.");

    const created = await createRequest(
      resolved.ctx,
      { customer_name: input.customer_name, customer_email: input.customer_email, customer_phone: input.customer_phone, subject: input.subject, body: input.body },
      "public_form",
    );
    if (created.autoProcess) {
      after(async () => {
        try {
          await processRequest(resolved.ctx, created.id);
        } catch (err) {
          console.error("[relayops] background processing failed", errorSummary(err));
        }
      });
    }
    return { reference: created.reference };
  });
}
