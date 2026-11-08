"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Copy, KeyRound, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { useAction } from "@/components/app/use-action";
import { addMemberAction, createKeyAction, revokeKeyAction, updateCategoryAction, updateMemberAction, updateSettingsAction } from "@/app/actions/admin";

const settingsSchema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  support_email: z.union([z.email("Enter a valid email"), z.literal("")]),
  timezone: z.string().trim().min(1, "Required"),
  public_intake_enabled: z.boolean(),
  member_request_visibility: z.enum(["assigned_and_unassigned", "all"]),
  medium_risk_requires_approval: z.boolean(),
  min_sample_for_metrics: z.number().int().min(1).max(1000),
  response_sign_off: z.string().trim().min(1, "Required").max(120),
  return_window_days: z.number().int().min(0).max(365),
});
export type SettingsValues = z.infer<typeof settingsSchema>;

export function BusinessSettingsForm({ initial, disabled }: { initial: SettingsValues; disabled: boolean }) {
  const { pending, run } = useAction();
  const { register, handleSubmit, formState } = useForm<SettingsValues>({ resolver: zodResolver(settingsSchema), defaultValues: initial });
  const e = formState.errors;
  return (
    <form onSubmit={handleSubmit((v) => run(() => updateSettingsAction(v)))} className="flex flex-col gap-4">
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name" htmlFor="s-name" error={e.name?.message}>
          <Input id="s-name" {...register("name")} />
        </Field>
        <Field label="Support email" htmlFor="s-email" error={e.support_email?.message}>
          <Input id="s-email" type="email" {...register("support_email")} />
        </Field>
        <Field label="Time zone" htmlFor="s-tz" error={e.timezone?.message} hint="IANA name, e.g. America/Denver">
          <Input id="s-tz" {...register("timezone")} />
        </Field>
        <Field label="Response sign-off" htmlFor="s-sign" error={e.response_sign_off?.message}>
          <Input id="s-sign" {...register("response_sign_off")} />
        </Field>
        <Field label="Return window (days)" htmlFor="s-ret" hint="Used by the deterministic refund eligibility check." error={e.return_window_days?.message}>
          <Input id="s-ret" type="number" {...register("return_window_days", { valueAsNumber: true })} />
        </Field>
        <Field label="Minimum sample for averages" htmlFor="s-min" hint="Completed requests needed before the dashboard shows resolution time." error={e.min_sample_for_metrics?.message}>
          <Input id="s-min" type="number" {...register("min_sample_for_metrics", { valueAsNumber: true })} />
        </Field>
        <Field label="Team members can see" htmlFor="s-vis" className="sm:col-span-2">
          <Select id="s-vis" {...register("member_request_visibility")}>
            <option value="assigned_and_unassigned">Requests assigned to them and unassigned requests</option>
            <option value="all">All requests</option>
          </Select>
        </Field>
        <label className="flex items-start gap-2 text-[13px] text-ink-2 sm:col-span-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" {...register("medium_risk_requires_approval")} />
          <span>
            Require owner approval for medium-risk actions too
            <span className="block text-xs text-muted">Status changes, assignments and internal notes. High-risk actions always require approval.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[13px] text-ink-2 sm:col-span-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" {...register("public_intake_enabled")} />
          <span>
            Accept requests from the public intake form
            <span className="block text-xs text-muted">Validated and rate limited per visitor.</span>
          </span>
        </label>
      </fieldset>
      {!disabled ? (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={pending}>
            Save settings
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function CategoryRow({ c }: { c: { id: string; label: string; description: string; is_enabled: boolean; baseline_manual_minutes: number; assisted_minutes: number } }) {
  const [v, setV] = useState(c);
  const { pending, run } = useAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(c);
  return (
    <form
      className="grid items-center gap-2 px-4 py-2 md:grid-cols-[auto_minmax(0,1fr)_7rem_7rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateCategoryAction(v));
      }}
    >
      <input type="checkbox" aria-label={`${c.label} enabled`} className="size-4 accent-[var(--color-accent)]" checked={v.is_enabled} onChange={(e) => setV({ ...v, is_enabled: e.target.checked })} />
      <div className="grid gap-1 sm:grid-cols-2">
        <Input aria-label="Label" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} className="h-8" />
        <Input aria-label="Description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} className="h-8" />
      </div>
      <Input aria-label="Manual minutes" type="number" min={0} step={0.5} value={v.baseline_manual_minutes} onChange={(e) => setV({ ...v, baseline_manual_minutes: Number(e.target.value) })} className="h-8 tabular" />
      <Input aria-label="Assisted minutes" type="number" min={0} step={0.5} value={v.assisted_minutes} onChange={(e) => setV({ ...v, assisted_minutes: Number(e.target.value) })} className="h-8 tabular" />
      <Button type="submit" size="sm" disabled={!dirty || pending}>
        Save
      </Button>
    </form>
  );
}

export function MemberControls({ m, self }: { m: { membership_id: string; role: "owner" | "member"; status: string; full_name: string }; self: boolean }) {
  const { pending, run } = useAction();
  if (self) return <span className="text-xs text-muted">You</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Select aria-label={`Role for ${m.full_name}`} className="h-8 w-auto text-[13px]" value={m.role} disabled={pending} onChange={(e) => run(() => updateMemberAction({ membership_id: m.membership_id, role: e.target.value, status: m.status }))}>
        <option value="owner">Owner</option>
        <option value="member">Team member</option>
      </Select>
      <Select aria-label={`Status for ${m.full_name}`} className="h-8 w-auto text-[13px]" value={m.status} disabled={pending} onChange={(e) => run(() => updateMemberAction({ membership_id: m.membership_id, role: m.role, status: e.target.value }))}>
        <option value="active">Active</option>
        <option value="disabled">Disabled</option>
      </Select>
    </div>
  );
}

export function AddMemberDialog() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ full_name: "", email: "", role: "member", title: "", password: "" });
  const { pending, run } = useAction();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus /> Add team member
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Add team member" description="They sign in with this email and the initial password you set.">
          <div className="flex flex-col gap-3">
            <Field label="Full name" htmlFor="m-name">
              <Input id="m-name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
            </Field>
            <Field label="Email" htmlFor="m-email">
              <Input id="m-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Role" htmlFor="m-role">
                <Select id="m-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                  <option value="member">Team member</option>
                  <option value="owner">Owner</option>
                </Select>
              </Field>
              <Field label="Title (optional)" htmlFor="m-title">
                <Input id="m-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
              </Field>
            </div>
            <Field label="Initial password" htmlFor="m-pass" hint="At least 12 characters.">
              <Input id="m-pass" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                run(() => addMemberAction({ ...f, title: f.title || undefined }), {
                  onSuccess: () => {
                    setOpen(false);
                    setF({ full_name: "", email: "", role: "member", title: "", password: "" });
                  },
                })
              }
            >
              Add team member
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CreateKey() {
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const { pending, run } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createKeyAction(name), { onSuccess: (d) => { setSecret(d.secret); setName(""); } });
        }}
      >
        <Input aria-label="Key name" placeholder="Key name, e.g. Website contact form" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button type="submit" disabled={pending || !name.trim()}>
          <KeyRound /> Create key
        </Button>
      </form>
      {secret ? (
        <div className="rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-[13px]">
          <p className="font-medium text-ink">Copy this key now. It is stored only as a hash and will not be shown again.</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-sm bg-surface px-2 py-1 font-mono text-xs">{secret}</code>
            <Button
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(secret);
                toast.success("Key copied.");
              }}
            >
              <Copy /> Copy
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RevokeKey({ id }: { id: string }) {
  const { pending, run } = useAction();
  return (
    <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => revokeKeyAction(id))}>
      Revoke
    </Button>
  );
}
