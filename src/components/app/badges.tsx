import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock,
  FileEdit,
  Hourglass,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Shield,
  Sparkles,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PROPOSAL_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  type ProposalStatus,
  type RequestStatus,
  type RiskLevel,
} from "@/lib/domain";

type Tone = "neutral" | "accent" | "amber" | "red" | "blue" | "violet" | "muted";

const TONES: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2 border-line",
  accent: "bg-accent-soft text-accent-strong border-accent/20",
  amber: "bg-amber-soft text-amber border-amber/25",
  red: "bg-red-soft text-red border-red/25",
  blue: "bg-blue-soft text-blue border-blue/20",
  violet: "bg-violet-soft text-violet border-violet/20",
  muted: "bg-surface text-muted border-line",
};

export function Badge({ tone = "neutral", icon: Icon, children, className, title }: { tone?: Tone; icon?: LucideIcon; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-px text-xs font-medium", TONES[tone], className)}>
      {Icon ? <Icon aria-hidden className="size-3.5" /> : null}
      {children}
    </span>
  );
}

const REQUEST_STATUS_STYLE: Record<RequestStatus, [Tone, LucideIcon]> = {
  new: ["blue", CircleDot],
  processing: ["violet", Loader2],
  needs_review: ["amber", FileEdit],
  awaiting_approval: ["amber", Hourglass],
  approved: ["accent", ShieldCheck],
  completed: ["accent", CheckCircle2],
  rejected: ["muted", Ban],
  failed: ["red", XCircle],
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const [tone, icon] = REQUEST_STATUS_STYLE[status];
  return (
    <Badge tone={tone} icon={icon}>
      {REQUEST_STATUS_LABELS[status]}
    </Badge>
  );
}

const PROPOSAL_STATUS_STYLE: Record<ProposalStatus, [Tone, LucideIcon]> = {
  draft: ["neutral", CircleDashed],
  pending_approval: ["amber", Hourglass],
  approved: ["accent", ShieldCheck],
  executing: ["violet", Loader2],
  executed: ["accent", CheckCircle2],
  failed: ["red", XCircle],
  rejected: ["muted", Ban],
  cancelled: ["muted", Ban],
};

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  const [tone, icon] = PROPOSAL_STATUS_STYLE[status];
  return (
    <Badge tone={tone} icon={icon}>
      {PROPOSAL_STATUS_LABELS[status]}
    </Badge>
  );
}

const RISK_STYLE: Record<RiskLevel, [Tone, LucideIcon, string]> = {
  low: ["neutral", Shield, "Low risk"],
  medium: ["blue", Shield, "Medium risk"],
  high: ["amber", ShieldAlert, "High risk"],
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const [tone, icon, label] = RISK_STYLE[risk];
  return (
    <Badge tone={tone} icon={icon} title="Risk of executing this action, set by RelayOps policy">
      {label}
    </Badge>
  );
}

export function OriginBadge({ origin }: { origin: "ai" | "user" | "rule" }) {
  if (origin === "ai") return <Badge tone="violet" icon={Sparkles}>AI suggested</Badge>;
  if (origin === "rule") return <Badge tone="neutral" icon={Zap}>Workflow rule</Badge>;
  return <Badge tone="neutral">Created by staff</Badge>;
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  if (priority === "urgent") return <Badge tone="red" icon={AlertTriangle}>Urgent</Badge>;
  if (priority === "high") return <Badge tone="amber" icon={AlertTriangle}>High</Badge>;
  return <Badge tone="muted">{priority === "low" ? "Low" : "Normal"}</Badge>;
}

export function UnresolvedBadge() {
  return <Badge tone="red" icon={Clock}>Unresolved</Badge>;
}

export function SimulatedBadge() {
  return (
    <Badge tone="violet" title="Recorded by the simulated delivery adapter. No real message left RelayOps.">
      Simulated
    </Badge>
  );
}
