import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-8 tracking-[-0.01em] text-ink">{title}</h1>
        {description ? <p className="mt-0.5 max-w-[70ch] text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-8">
      <p className="font-medium text-ink">{title}</p>
      {children ? <div className="max-w-[60ch] text-[13px] text-muted">{children}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "neutral", title, children, icon }: { tone?: "neutral" | "amber" | "red" | "violet" | "accent"; title?: string; children: React.ReactNode; icon?: React.ReactNode }) {
  const styles = {
    neutral: "border-line bg-sunken/70 text-ink-2",
    amber: "border-amber/25 bg-amber-soft text-ink-2",
    red: "border-red/25 bg-red-soft text-ink-2",
    violet: "border-violet/20 bg-violet-soft text-ink-2",
    accent: "border-accent/20 bg-accent-soft text-ink-2",
  }[tone];
  return (
    <div role={tone === "red" ? "alert" : undefined} className={cn("flex gap-2.5 rounded-md border px-3 py-2.5 text-[13px]", styles)}>
      {icon ? <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span> : null}
      <div className="min-w-0">
        {title ? <p className="font-medium text-ink">{title}</p> : null}
        <div className={title ? "mt-0.5" : undefined}>{children}</div>
      </div>
    </div>
  );
}
