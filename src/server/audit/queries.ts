import "server-only";
import { z } from "zod";
import { withTenant } from "@/server/db/tenant";
import type { UserContext } from "@/server/auth/types";

export const auditFilterSchema = z.object({
  type: z.string().trim().regex(/^[a-z_]+(\.[a-z_]+)?$/).optional().catch(undefined),
  result: z.enum(["success", "failure", "denied", "info"]).optional().catch(undefined),
  actor: z.enum(["user", "system", "ai", "public"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
export type AuditFilters = z.infer<typeof auditFilterSchema>;

const PAGE = 40;

/** Read-only view of the audit log. RLS limits members to events they may see. */
export async function listAuditEvents(ctx: UserContext, filters: AuditFilters) {
  return withTenant(ctx, async (tx) => {
    const where: string[] = ["true"];
    const params: unknown[] = [];
    if (filters.type) {
      params.push(filters.type.includes(".") ? filters.type : `${filters.type}.%`);
      where.push(filters.type.includes(".") ? `e.event_type = $${params.length}` : `e.event_type like $${params.length}`);
    }
    if (filters.result) {
      params.push(filters.result);
      where.push(`e.result = $${params.length}`);
    }
    if (filters.actor) {
      params.push(filters.actor);
      where.push(`e.actor_type = $${params.length}`);
    }
    const w = where.join(" and ");
    const total = await tx.one<{ n: number }>(`select count(*)::int as n from audit_events e where ${w}`, params);
    const rows = await tx.many<{
      id: string;
      event_type: string;
      actor_type: string;
      actor_name: string | null;
      result: string;
      request_id: string | null;
      reference: string | null;
      entity_type: string | null;
      entity_id: string | null;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `select e.id, e.event_type, e.actor_type, p.full_name as actor_name, e.result, e.request_id, r.reference,
              e.entity_type, e.entity_id, e.metadata, e.created_at
         from audit_events e
         left join profiles p on p.id = e.actor_user_id
         left join customer_requests r on r.id = e.request_id
        where ${w}
        order by e.created_at desc, e.id
        limit ${PAGE} offset ${(filters.page - 1) * PAGE}`,
      params,
    );
    const types = await tx.many<{ prefix: string }>("select distinct split_part(event_type, '.', 1) as prefix from audit_events order by 1");
    return { rows, total: total.n, page: filters.page, pageCount: Math.max(1, Math.ceil(total.n / PAGE)), prefixes: types.map((t) => t.prefix) };
  });
}
