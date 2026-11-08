"use client";

import { useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/app/use-action";
import { deleteRuleAction, saveRuleAction, toggleRuleAction } from "@/app/actions/admin";
import { CONDITION_FIELDS, OPERATOR_LABELS, RULE_ACTION_LABELS, RULE_TRIGGERS, TRIGGER_LABELS, type RuleActionType, type RuleTrigger } from "@/server/rules/schemas";
import { ACTION_META, ACTION_TYPES, PRIORITIES, REQUEST_CHANNELS, CHANNEL_LABELS } from "@/lib/domain";

type Condition = { field: string; op: string; value: string | number | boolean | string[] };
export type RuleFormValue = {
  name: string;
  description: string;
  is_enabled: boolean;
  trigger: RuleTrigger;
  conditions: Condition[];
  action: Record<string, unknown> & { type: RuleActionType };
  requires_approval: boolean;
  sort_order: number;
};

const ACTIONS_BY_TRIGGER: Record<RuleTrigger, RuleActionType[]> = {
  "request.created": ["process_with_ai", "assign_to", "set_priority"],
  "request.classified": ["assign_to", "set_priority", "require_human_review"],
  "request.unresolved_check": ["flag_unresolved"],
  "proposal.created": ["require_approval"],
};
const FIELDS_BY_TRIGGER: Record<RuleTrigger, string[]> = {
  "request.created": ["channel", "has_customer_record"],
  "request.classified": ["category", "channel", "priority", "has_customer_record", "evidence_count", "injection_suspected", "uncertainty_level"],
  "request.unresolved_check": ["category", "priority", "channel"],
  "proposal.created": ["action_type", "category"],
};

function defaultAction(type: RuleActionType, team: { user_id: string }[]): RuleFormValue["action"] {
  switch (type) {
    case "assign_to":
      return { type, user_id: team[0]?.user_id ?? "" };
    case "set_priority":
      return { type, priority: "high" };
    case "require_human_review":
      return { type, reason: "" };
    case "flag_unresolved":
      return { type, after_hours: 24 };
    case "require_approval":
      return { type, action_types: ["update_request_status"] };
    default:
      return { type };
  }
}

function valueOptions(field: string, categories: { key: string; label: string }[]): { value: string; label: string }[] | null {
  switch (field) {
    case "category":
      return categories.map((c) => ({ value: c.key, label: c.label }));
    case "channel":
      return REQUEST_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }));
    case "priority":
      return PRIORITIES.map((p) => ({ value: p, label: p }));
    case "uncertainty_level":
      return ["low", "medium", "high"].map((p) => ({ value: p, label: p }));
    case "action_type":
      return ACTION_TYPES.map((a) => ({ value: a, label: ACTION_META[a].label }));
    default:
      return null;
  }
}

function ConditionRow({ c, onChange, onRemove, fields, categories, idx }: { c: Condition; onChange: (c: Condition) => void; onRemove: () => void; fields: string[]; categories: { key: string; label: string }[]; idx: number }) {
  const kind = CONDITION_FIELDS[c.field as keyof typeof CONDITION_FIELDS]?.type ?? "string";
  const ops = kind === "number" ? ["eq", "gte", "lte"] : kind === "boolean" ? ["eq", "neq"] : ["eq", "neq", "in"];
  const opts = valueOptions(c.field, categories);
  const resetFor = (field: string): Condition => {
    const k = CONDITION_FIELDS[field as keyof typeof CONDITION_FIELDS].type;
    const first = valueOptions(field, categories)?.[0]?.value ?? "";
    return { field, op: "eq", value: k === "number" ? 0 : k === "boolean" ? true : first };
  };
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_8rem_1.4fr_auto]">
      <Select aria-label={`Condition ${idx + 1} field`} value={c.field} onChange={(e) => onChange(resetFor(e.target.value))}>
        {fields.map((f) => (
          <option key={f} value={f}>
            {CONDITION_FIELDS[f as keyof typeof CONDITION_FIELDS].label}
          </option>
        ))}
      </Select>
      <Select
        aria-label={`Condition ${idx + 1} operator`}
        value={c.op}
        onChange={(e) => {
          const op = e.target.value;
          const value = op === "in" ? (Array.isArray(c.value) ? c.value : [String(c.value)]) : Array.isArray(c.value) ? (c.value[0] ?? "") : c.value;
          onChange({ ...c, op, value });
        }}
      >
        {ops.map((o) => (
          <option key={o} value={o}>
            {OPERATOR_LABELS[o as keyof typeof OPERATOR_LABELS]}
          </option>
        ))}
      </Select>
      {kind === "number" ? (
        <Input aria-label={`Condition ${idx + 1} value`} type="number" min={0} value={Number(c.value)} onChange={(e) => onChange({ ...c, value: Number(e.target.value) })} />
      ) : kind === "boolean" ? (
        <Select aria-label={`Condition ${idx + 1} value`} value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value === "true" })}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      ) : c.op === "in" && opts ? (
        <Select
          aria-label={`Condition ${idx + 1} values`}
          multiple
          value={Array.isArray(c.value) ? c.value : []}
          onChange={(e) => onChange({ ...c, value: Array.from(e.target.selectedOptions).map((o) => o.value) })}
          className="h-auto min-h-20 py-1"
        >
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : opts ? (
        <Select aria-label={`Condition ${idx + 1} value`} value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value })}>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input aria-label={`Condition ${idx + 1} value`} value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value })} />
      )}
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove condition ${idx + 1}`}>
        <Trash2 />
      </Button>
    </div>
  );
}

export function RuleEditor({ ruleId, initial, team, categories }: { ruleId: string | null; initial?: RuleFormValue; team: { user_id: string; full_name: string }[]; categories: { key: string; label: string }[] }) {
  const blank: RuleFormValue = { name: "", description: "", is_enabled: true, trigger: "request.classified", conditions: [], action: defaultAction("require_human_review", team), requires_approval: false, sort_order: 100 };
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<RuleFormValue>(initial ?? blank);
  const { pending, run } = useAction();
  const fields = FIELDS_BY_TRIGGER[v.trigger];

  return (
    <>
      {ruleId ? (
        <Button size="sm" variant="ghost" onClick={() => { setV(initial ?? blank); setOpen(true); }}>
          <Pencil /> Edit
        </Button>
      ) : (
        <Button variant="primary" onClick={() => { setV(blank); setOpen(true); }}>
          <Plus /> New rule
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={ruleId ? "Edit rule" : "New rule"} description="Rules run in order, are checked when saved, and can only make the workflow stricter." wide>
          <div className="flex flex-col gap-3">
            <Field label="Name" htmlFor="r-name">
              <Input id="r-name" value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} />
            </Field>
            <Field label="Description" htmlFor="r-desc">
              <Textarea id="r-desc" value={v.description} maxLength={1000} rows={2} className="min-h-14" onChange={(e) => setV({ ...v, description: e.target.value })} />
            </Field>
            <Field label="When" htmlFor="r-trigger">
              <Select
                id="r-trigger"
                value={v.trigger}
                onChange={(e) => {
                  const trigger = e.target.value as RuleTrigger;
                  setV({ ...v, trigger, conditions: [], action: defaultAction(ACTIONS_BY_TRIGGER[trigger][0], team), requires_approval: false });
                }}
              >
                {RULE_TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>

            <fieldset className="rounded-md border border-line p-3">
              <legend className="px-1 text-[13px] font-medium text-ink-2">Only if (all must match)</legend>
              <div className="flex flex-col gap-2">
                {v.conditions.length === 0 ? <p className="text-xs text-muted">No conditions: the rule applies every time.</p> : null}
                {v.conditions.map((c, i) => (
                  <ConditionRow
                    key={i}
                    idx={i}
                    c={c}
                    fields={fields}
                    categories={categories}
                    onChange={(nc) => setV({ ...v, conditions: v.conditions.map((x, j) => (j === i ? nc : x)) })}
                    onRemove={() => setV({ ...v, conditions: v.conditions.filter((_, j) => j !== i) })}
                  />
                ))}
                {v.conditions.length < 5 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="self-start"
                    onClick={() => {
                      const field = fields[0];
                      const kind = CONDITION_FIELDS[field as keyof typeof CONDITION_FIELDS].type;
                      setV({ ...v, conditions: [...v.conditions, { field, op: "eq", value: kind === "number" ? 0 : kind === "boolean" ? true : (valueOptions(field, categories)?.[0]?.value ?? "") }] });
                    }}
                  >
                    <Plus /> Add condition
                  </Button>
                ) : null}
              </div>
            </fieldset>

            <Field label="Then" htmlFor="r-action">
              <Select id="r-action" value={v.action.type} onChange={(e) => setV({ ...v, action: defaultAction(e.target.value as RuleActionType, team), requires_approval: false })}>
                {ACTIONS_BY_TRIGGER[v.trigger].map((a) => (
                  <option key={a} value={a}>
                    {RULE_ACTION_LABELS[a]}
                  </option>
                ))}
              </Select>
            </Field>
            {v.action.type === "assign_to" ? (
              <>
                <Field label="Team member" htmlFor="r-user">
                  <Select id="r-user" value={String(v.action.user_id)} onChange={(e) => setV({ ...v, action: { ...v.action, user_id: e.target.value } })}>
                    {team.map((t) => (
                      <option key={t.user_id} value={t.user_id}>
                        {t.full_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={v.requires_approval} onChange={(e) => setV({ ...v, requires_approval: e.target.checked })} />
                  Create an assignment proposal for owner approval instead of assigning directly
                </label>
              </>
            ) : null}
            {v.action.type === "set_priority" ? (
              <Field label="Priority" htmlFor="r-priority">
                <Select id="r-priority" value={String(v.action.priority)} onChange={(e) => setV({ ...v, action: { ...v.action, priority: e.target.value } })}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {v.action.type === "require_human_review" ? (
              <Field label="Reason shown to reviewers" htmlFor="r-reason">
                <Input id="r-reason" value={String(v.action.reason)} maxLength={200} onChange={(e) => setV({ ...v, action: { ...v.action, reason: e.target.value } })} />
              </Field>
            ) : null}
            {v.action.type === "flag_unresolved" ? (
              <Field label="Flag after (hours open)" htmlFor="r-hours">
                <Input id="r-hours" type="number" min={1} max={720} value={Number(v.action.after_hours)} onChange={(e) => setV({ ...v, action: { ...v.action, after_hours: Number(e.target.value) } })} />
              </Field>
            ) : null}
            {v.action.type === "require_approval" ? (
              <Field label="Actions that need approval" htmlFor="r-types" hint="High-risk actions always need approval; this adds approval for others.">
                <Select
                  id="r-types"
                  multiple
                  className="h-auto min-h-28 py-1"
                  value={(v.action.action_types as string[]) ?? []}
                  onChange={(e) => setV({ ...v, action: { ...v.action, action_types: Array.from(e.target.selectedOptions).map((o) => o.value) } })}
                >
                  {ACTION_TYPES.map((a) => (
                    <option key={a} value={a}>
                      {ACTION_META[a].label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Order" htmlFor="r-order" hint="Lower runs first.">
                <Input id="r-order" type="number" min={0} max={10000} value={v.sort_order} onChange={(e) => setV({ ...v, sort_order: Number(e.target.value) })} />
              </Field>
              <label className="mt-6 flex items-center gap-2 text-[13px] text-ink-2">
                <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={v.is_enabled} onChange={(e) => setV({ ...v, is_enabled: e.target.checked })} />
                Enabled
              </label>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={pending} onClick={() => run(() => saveRuleAction(ruleId, v), { onSuccess: () => setOpen(false) })}>
              {ruleId ? "Save rule" : "Create rule"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RuleToggle({ ruleId, enabled }: { ruleId: string; enabled: boolean }) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? "Disable rule" : "Enable rule"}
      disabled={pending}
      onClick={() => run(() => toggleRuleAction(ruleId, !enabled))}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${enabled ? "border-accent bg-accent" : "border-line-strong bg-sunken"}`}
    >
      <span className={`inline-block size-3.5 rounded-full bg-surface shadow-raise transition-transform ${enabled ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

export function RuleDelete({ ruleId, name }: { ruleId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Delete ${name}`}>
        <Trash2 />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Delete this rule?" description={`"${name}" stops applying immediately. Past executions stay in the audit log.`}>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={pending} onClick={() => run(() => deleteRuleAction(ruleId), { onSuccess: () => setOpen(false) })}>
              Delete rule
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
