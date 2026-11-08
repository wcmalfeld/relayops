import type { Metadata } from "next";
import { requireUser } from "@/server/auth/context";
import { listApprovalQueue } from "@/server/requests/queries";
import { can } from "@/server/auth/permissions";
import { PageHeader, EmptyState, Notice } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { ProposalCard, type ProposalCardData } from "@/components/app/proposal-card";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const ctx = await requireUser();
  const { items, paramLabels, timezone } = await listApprovalQueue(ctx);
  const pending = items.filter((i) => i.status === "pending_approval");
  const ready = items.filter((i) => i.status !== "pending_approval");
  const perms = {
    canEdit: false,
    canSubmit: false,
    canDecide: can(ctx, "proposals.decide"),
    canExecuteApproved: can(ctx, "proposals.execute_approved"),
    canExecuteMedium: can(ctx, "proposals.execute_medium"),
    canCancel: false,
  };
  const render = (i: (typeof items)[number]) => (
    <ProposalCard
      key={i.id}
      proposal={JSON.parse(JSON.stringify(i)) as ProposalCardData}
      paramLabels={paramLabels}
      evidenceLabels={Object.fromEntries(i.evidence.map((e) => [e.ref, e.label]))}
      customerName={i.customer_name}
      perms={perms}
      options={{ team: [], slots: [], orders: [], customerId: null, customerEmail: null, timezone }}
      context={{ reference: i.reference, subject: i.subject }}
    />
  );

  return (
    <>
      <PageHeader
        title="Approvals"
        description="High-risk actions wait here for an owner. Each approval covers one exact version of the values shown; any edit voids it."
      />
      {!perms.canDecide ? (
        <div className="mb-4">
          <Notice>You can see what is waiting, but only an owner can approve or reject. Open the request to edit a proposal.</Notice>
        </div>
      ) : null}

      <section aria-labelledby="pending-h" className="mb-8">
        <h2 id="pending-h" className="mb-2 text-[15px] font-semibold text-ink">
          Waiting for approval <span className="tabular font-normal text-muted">({pending.length})</span>
        </h2>
        {pending.length ? (
          <div className="grid items-start gap-4 xl:grid-cols-2">{pending.map(render)}</div>
        ) : (
          <Card>
            <EmptyState title="Nothing is waiting for approval">Proposals appear here after someone sends them for approval from a request.</EmptyState>
          </Card>
        )}
      </section>

      {ready.length ? (
        <section aria-labelledby="ready-h">
          <h2 id="ready-h" className="mb-2 text-[15px] font-semibold text-ink">
            Approved or failed, not yet executed <span className="tabular font-normal text-muted">({ready.length})</span>
          </h2>
          <div className="grid items-start gap-4 xl:grid-cols-2">{ready.map(render)}</div>
        </section>
      ) : null}
    </>
  );
}
