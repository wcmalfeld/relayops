"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Dialog as D } from "radix-ui";
import { BookOpen, ClipboardCheck, Gauge, Inbox, LogOut, Menu, ScrollText, Settings, Workflow, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RelayMark } from "@/components/app/brand";
import { logoutAction, switchBusinessAction } from "@/app/actions/auth";
import type { MembershipSummary } from "@/server/auth/session-service";

type Props = {
  user: { name: string; email: string; role: "owner" | "member" };
  business: { id: string; name: string };
  memberships: MembershipSummary[];
  counts: { approvals: number; review: number };
  canManage: boolean;
};

const NAV = [
  { href: "/dashboard", label: "Overview", icon: Gauge },
  { href: "/requests", label: "Requests", icon: Inbox, count: "review" as const },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck, count: "approvals" as const },
  { href: "/records", label: "Business records", icon: BookOpen },
  { href: "/rules", label: "Workflow rules", icon: Workflow },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ counts, onNavigate }: { counts: Props["counts"]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const n = item.count ? counts[item.count] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium",
              active ? "bg-sunken text-ink" : "text-ink-2 hover:bg-sunken/70 hover:text-ink",
            )}
          >
            <item.icon aria-hidden className={cn("size-4", active ? "text-accent" : "text-faint")} />
            <span className="flex-1">{item.label}</span>
            {n > 0 ? (
              <span className={cn("tabular rounded-sm px-1.5 text-xs", item.count === "approvals" ? "bg-amber-soft text-amber" : "bg-sunken text-muted")} aria-label={`${n} waiting`}>
                {n}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function Footer({ user, business, memberships }: Pick<Props, "user" | "business" | "memberships">) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      {memberships.length > 1 ? (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Business
          <select
            className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink"
            value={business.id}
            onChange={(e) => void switchBusinessAction(e.target.value)}
          >
            {memberships.map((m) => (
              <option key={m.businessId} value={m.businessId}>
                {m.businessName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.role === "owner" ? "Owner" : "Team member"}</p>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

export function Sidebar(props: Props) {
  const [open, setOpen] = useState(false);
  const header = (
    <div className="flex items-center gap-2 px-1">
      <RelayMark />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold leading-4 text-ink">RelayOps</p>
        <p className="truncate text-xs leading-4 text-muted">{props.business.name}</p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-r border-line bg-surface px-3 py-4 lg:flex">
        {header}
        <div className="flex-1">
          <NavLinks counts={props.counts} />
        </div>
        <Footer {...props} />
      </aside>

      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-2.5 lg:hidden">
        {header}
        <D.Root open={open} onOpenChange={setOpen}>
          <D.Trigger className="rounded-md p-2 text-ink-2 hover:bg-sunken" aria-label="Open navigation">
            <Menu className="size-5" />
          </D.Trigger>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-40 bg-ink/40" />
            <D.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-6 bg-surface px-3 py-4 shadow-pop focus:outline-none">
              <D.Title className="sr-only">Navigation</D.Title>
              <D.Description className="sr-only">Main sections of RelayOps</D.Description>
              <div className="flex items-center justify-between">
                {header}
                <D.Close className="rounded-md p-1.5 text-muted hover:bg-sunken" aria-label="Close navigation">
                  <X className="size-4" />
                </D.Close>
              </div>
              <div className="flex-1">
                <NavLinks counts={props.counts} onNavigate={() => setOpen(false)} />
              </div>
              <Footer {...props} />
            </D.Content>
          </D.Portal>
        </D.Root>
      </div>
    </>
  );
}

