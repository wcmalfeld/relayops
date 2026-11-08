import { requireUser } from "@/server/auth/context";
import { listMemberships } from "@/server/auth/session-service";
import { withTenant } from "@/server/db/tenant";
import { can } from "@/server/auth/permissions";
import { Sidebar } from "@/components/app/sidebar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireUser();
  const [memberships, counts] = await Promise.all([
    listMemberships(ctx.userId),
    withTenant(ctx, (tx) =>
      tx.one<{ approvals: number; review: number; demo: boolean }>(
        `select (select count(*)::int from action_proposals where status = 'pending_approval') as approvals,
                (select count(*)::int from customer_requests where status in ('new', 'needs_review')) as review,
                (select is_demo from businesses where id = app.current_business_id()) as demo`,
      ),
    ),
  ]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <Sidebar
        user={{ name: ctx.fullName, email: ctx.email, role: ctx.role }}
        business={{ id: ctx.businessId, name: ctx.businessName }}
        memberships={memberships}
        counts={{ approvals: counts.approvals, review: counts.review }}
        canManage={can(ctx, "settings.manage")}
      />
      <div className="min-w-0">
        {counts.demo ? (
          <div className="border-b border-violet/15 bg-violet-soft px-4 py-1.5 text-center text-xs text-ink-2 lg:px-8">
            Demonstration business with fictional data. Customer messages are delivered by a simulated adapter; nothing is emailed.
          </div>
        ) : null}
        <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
