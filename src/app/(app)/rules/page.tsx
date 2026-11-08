import type { Metadata } from "next";
import { requireUser } from "@/server/auth/context";
import { listRules, type RuleRow } from "@/server/rules/service";
import { can } from "@/server/auth/permissions";
import { PageHeader, EmptyState, Notice } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/app/badges";
import { RuleDelete, RuleEditor, RuleToggle, type RuleFormValue } from "./rule-editor";
import { CONDITION_FIELDS, OPERATOR_LABELS, RULE_ACTION_LABELS, RULE_TRIGGERS, TRIGGER_LABELS } from "@/server/rules/schemas";
import { ACTION_META, type ActionType } from "@/lib/domain";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Workflow rules" };

export default async function RulesPage() {
  const ctx = await requireUser();
  const { rules, team, categories } = await listRules(ctx);
  const manage = can(ctx, "rules.manage");
  const name = (id: unknown) => team.find((t) => t.user_id === id)?.full_name ?? "unknown member";
  const cat = (k: unknown) => categories.find((c) => c.key === k)?.label ?? String(k);

  const describeAction = (r: RuleRow) => {
    const a = r.action as Record<string, unknown>;
    switch (r.action.type) {
      case "assign_to":
        return `Assign to ${name(a.user_id)}${r.requires_approval ? " (as a proposal needing approval)" : ""}`;
      case "set_priority":
        return `Set priority to ${a.priority}`;
      case "require_human_review":
        return `Require human review: ${a.reason}`;
      case "flag_unresolved":
        return `Flag after ${a.after_hours} hours open`;
      case "require_approval":
        return `Require approval for ${(a.action_types as ActionType[]).map((t) => ACTION_META[t]?.label.toLowerCase()).join(", ")}`;
      default:
        return RULE_ACTION_LABELS[r.action.type];
    }
  };
  const describeValue = (field: string, v: unknown) => {
    const one = (x: unknown) => (field === "category" ? cat(x) : field === "action_type" ? (ACTION_META[x as ActionType]?.label ?? String(x)) : typeof x === "boolean" ? (x ? "yes" : "no") : String(x).replace(/_/g, " "));
    return Array.isArray(v) ? v.map(one).join(", ") : one(v);
  };

  return (
    <>
      <PageHeader
        title="Workflow rules"
        description="Deterministic rules: a trigger, conditions that all must match, and one effect. Rules can tighten the workflow but never bypass the approval policy."
        actions={manage ? <RuleEditor ruleId={null} team={team} categories={categories} /> : null}
      />
      {!manage ? (
        <div className="mb-4">
          <Notice>Only owners can change workflow rules.</Notice>
        </div>
      ) : null}
      <div className="flex flex-col gap-6">
        {RULE_TRIGGERS.map((t) => {
          const group = rules.filter((r) => r.trigger === t);
          return (
            <section key={t} aria-labelledby={`t-${t}`}>
              <h2 id={`t-${t}`} className="mb-2 text-[15px] font-semibold text-ink">
                {TRIGGER_LABELS[t]}
              </h2>
              <Card>
                {group.length === 0 ? (
                  <EmptyState title="No rules for this trigger" />
                ) : (
                  <ul className="divide-y divide-line">
                    {group.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                        {manage ? <RuleToggle ruleId={r.id} enabled={r.is_enabled} /> : <Badge tone={r.is_enabled ? "accent" : "muted"}>{r.is_enabled ? "On" : "Off"}</Badge>}
                        <div className="min-w-0 flex-1">
                          <p className={`font-medium ${r.is_enabled ? "text-ink" : "text-muted"}`}>{r.name}</p>
                          {r.description ? <p className="text-[13px] text-muted">{r.description}</p> : null}
                          <p className="mt-1 text-[13px] text-ink-2">
                            {r.conditions.length
                              ? `If ${r.conditions.map((c) => `${CONDITION_FIELDS[c.field].label.toLowerCase()} ${OPERATOR_LABELS[c.op]} ${describeValue(c.field, c.value)}`).join(" and ")}: `
                              : "Always: "}
                            <span className="font-medium">{describeAction(r)}</span>
                          </p>
                          <p className="mt-1 text-2xs text-faint">
                            {r.trigger === "proposal.created" ? "Checked each time a proposal is created" : `Applied ${r.times_applied} time${r.times_applied === 1 ? "" : "s"}`}. Updated {formatDateTime(r.updated_at)}
                            {r.updated_by_name ? ` by ${r.updated_by_name}` : ""}.
                          </p>
                        </div>
                        {manage ? (
                          <div className="flex gap-1">
                            <RuleEditor
                              ruleId={r.id}
                              team={team}
                              categories={categories}
                              initial={JSON.parse(JSON.stringify({ name: r.name, description: r.description, is_enabled: r.is_enabled, trigger: r.trigger, conditions: r.conditions, action: r.action, requires_approval: r.requires_approval, sort_order: r.sort_order })) as RuleFormValue}
                            />
                            <RuleDelete ruleId={r.id} name={r.name} />
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>
          );
        })}
      </div>
    </>
  );
}
