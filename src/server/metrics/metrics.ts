import "server-only";
import { withTenant } from "@/server/db/tenant";
import type { UserContext } from "@/server/auth/types";
import { assertCan } from "@/server/auth/permissions";
import { loadBusiness } from "@/server/settings/business";

export type DashboardMetrics = Awaited<ReturnType<typeof getDashboardMetrics>>;

/**
 * Database-backed dashboard metrics.
 *
 * Measured: counts, and average time to resolution (received -> resolved)
 * once at least `min_sample_for_metrics` requests are resolved.
 *
 * Estimated: staff time saved = for each completed request that AI
 * processing assisted, (baseline manual minutes - assisted minutes) for its
 * category. Both inputs are configured per category in Settings; the result
 * is an estimate, not a measurement.
 */
export async function getDashboardMetrics(ctx: UserContext) {
  assertCan(ctx, "metrics.view");
  return withTenant(ctx, async (tx) => {
    const business = await loadBusiness(tx);
    const counts = await tx.one<{
      new_count: number;
      needs_review: number;
      awaiting_approval: number;
      open_total: number;
      flagged_unresolved: number;
      completed_total: number;
    }>(
      `select
          count(*) filter (where status = 'new')::int as new_count,
          count(*) filter (where status = 'needs_review')::int as needs_review,
          count(*) filter (where status = 'awaiting_approval')::int as awaiting_approval,
          count(*) filter (where status not in ('completed', 'rejected'))::int as open_total,
          count(*) filter (where flagged_unresolved_at is not null and status not in ('completed', 'rejected'))::int as flagged_unresolved,
          count(*) filter (where status = 'completed')::int as completed_total
         from customer_requests`,
    );
    const actions = await tx.one<{ pending_approval: number; executed: number; failed: number; blocked: number }>(
      `select
          (select count(*)::int from action_proposals where status = 'pending_approval') as pending_approval,
          (select count(*)::int from action_proposals where status = 'executed') as executed,
          (select count(*)::int from action_proposals where status = 'failed') as failed,
          (select count(*)::int from audit_events where event_type = 'proposal.blocked_by_policy') as blocked`,
    );
    const byCategory = await tx.many<{ key: string; label: string; count: number }>(
      `select coalesce(c.key, 'unclassified') as key, coalesce(c.label, 'Not yet classified') as label, count(r.id)::int as count
         from customer_requests r left join request_categories c on c.key = r.category
        group by 1, 2 order by count desc, label`,
    );
    const resolution = await tx.one<{ n: number; avg_hours: number | null; median_hours: number | null }>(
      `select count(*)::int as n,
              avg(extract(epoch from (resolved_at - received_at)) / 3600)::float as avg_hours,
              percentile_cont(0.5) within group (order by extract(epoch from (resolved_at - received_at)) / 3600)::float as median_hours
         from customer_requests where status = 'completed' and resolved_at is not null`,
    );
    const saved = await tx.one<{ assisted_completed: number; minutes: number | null }>(
      `select count(*)::int as assisted_completed,
              sum(greatest(c.baseline_manual_minutes - c.assisted_minutes, 0))::float as minutes
         from customer_requests r join request_categories c on c.key = r.category
        where r.status = 'completed' and r.ai_status = 'completed'`,
    );
    const demo = await tx.one<{ demo: number; total: number }>("select count(*) filter (where is_demo)::int as demo, count(*)::int as total from customer_requests");
    const recent = await tx.many<{
      id: string;
      event_type: string;
      actor_type: string;
      actor_name: string | null;
      result: string;
      request_id: string | null;
      reference: string | null;
      created_at: Date;
      metadata: Record<string, unknown>;
    }>(
      `select e.id, e.event_type, e.actor_type, p.full_name as actor_name, e.result, e.request_id, r.reference, e.created_at, e.metadata
         from audit_events e
         left join profiles p on p.id = e.actor_user_id
         left join customer_requests r on r.id = e.request_id
        where e.event_type not in ('auth.signed_in', 'action.execution_started', 'retrieval.completed', 'ai.processing_started')
        order by e.created_at desc limit 12`,
    );

    const minSample = business.settings.min_sample_for_metrics;
    return {
      business,
      counts,
      actions,
      byCategory,
      resolution: { ...resolution, sufficient: resolution.n >= minSample, minSample },
      timeSaved: { assistedCompleted: saved.assisted_completed, minutes: saved.minutes ?? 0 },
      demoShare: { demo: demo.demo, total: demo.total },
      recent,
    };
  });
}
