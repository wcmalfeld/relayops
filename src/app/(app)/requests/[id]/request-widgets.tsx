"use client";

import { useState } from "react";
import { Plus, RefreshCw, Sparkles, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/app/use-action";
import { ParamsFields, cleanParams, defaultParams, type ActionOptions, type Params } from "@/components/app/action-forms";
import { processRequestAction, correctClassificationAction } from "@/app/actions/requests";
import { staffActionAction } from "@/app/actions/proposals";
import { ACTION_META, ACTION_TYPES, type ActionType } from "@/lib/domain";

export function ProcessButton({ requestId, reprocess }: { requestId: string; reprocess: boolean }) {
  const { pending, run } = useAction();
  return (
    <Button
      variant={reprocess ? "secondary" : "primary"}
      disabled={pending}
      onClick={() =>
        run(() => processRequestAction(requestId), {
          success: (o) =>
            o.status === "completed"
              ? `Processed: ${o.proposalsCreated} proposal${o.proposalsCreated === 1 ? "" : "s"} ready for review${o.proposalsBlocked ? `, ${o.proposalsBlocked} refused by policy` : ""}.`
              : null,
          onSuccess: (o) => {
            if (o.status === "failed") toast.error(`AI processing unavailable (${o.errorCode}). Continue manually with the actions below.`);
          },
        })
      }
    >
      {reprocess ? <RefreshCw /> : <Sparkles />}
      {pending ? "Processing…" : reprocess ? "Reprocess with AI" : "Process with AI"}
    </Button>
  );
}

export function CorrectClassification({ requestId, category, summary, categories }: { requestId: string; category: string | null; summary: string; categories: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: category ?? categories[0]?.key ?? "other", summary, reason: "" });
  const { pending, run } = useAction();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <PencilLine /> Correct
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Correct the classification" description="Saved as a staff correction. The AI's original output stays in the history.">
          <div className="flex flex-col gap-3">
            <Field label="Category" htmlFor="cc-category">
              <Select id="cc-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Summary" htmlFor="cc-summary">
              <Textarea id="cc-summary" value={form.summary} maxLength={1000} rows={3} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
            </Field>
            <Field label="Why are you correcting it?" htmlFor="cc-reason">
              <Input id="cc-reason" value={form.reason} maxLength={300} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={pending} onClick={() => run(() => correctClassificationAction({ request_id: requestId, ...form }), { onSuccess: () => setOpen(false) })}>
              Save correction
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NewActionDialog({ requestId, options, initialType }: { requestId: string; options: ActionOptions; initialType?: ActionType }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ActionType>(initialType ?? "add_internal_note");
  const [params, setParams] = useState<Params>(() => defaultParams(initialType ?? "add_internal_note", options));
  const [explanation, setExplanation] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>();
  const { pending, run } = useAction();
  const meta = ACTION_META[type];
  const needsApproval = meta.risk === "high";
  const unavailable =
    (type === "draft_customer_response" && !options.customerEmail) ||
    (["create_service_request", "propose_appointment", "prepare_refund_request"].includes(type) && !options.customerId) ||
    (type === "prepare_refund_request" && options.orders.length === 0) ||
    (type === "propose_appointment" && options.slots.length === 0);

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setErrors(undefined);
          setOpen(true);
        }}
      >
        <Plus /> New action
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New action" description="Staff actions use the same validation and approval rules as AI suggestions." wide>
          <div className="flex flex-col gap-3">
            <Field label="Action" htmlFor="na-type">
              <Select
                id="na-type"
                value={type}
                onChange={(e) => {
                  const t = e.target.value as ActionType;
                  setType(t);
                  setParams(defaultParams(t, options));
                  setErrors(undefined);
                }}
              >
                {ACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACTION_META[t].label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="rounded-md border border-line bg-sunken/50 px-3 py-2 text-[13px] text-ink-2">
              {meta.effect} {needsApproval ? "This needs owner approval before it runs." : "This runs as soon as you confirm."}
            </p>
            {unavailable ? (
              <p className="text-[13px] text-red">
                {type === "draft_customer_response"
                  ? "This request has no customer email, so no response can be sent."
                  : type === "propose_appointment" && options.customerId
                    ? "There are no open appointment slots."
                    : type === "prepare_refund_request" && options.customerId
                      ? "This customer has no orders."
                      : "The sender is not linked to a customer record, so customer records cannot be changed from this request."}
              </p>
            ) : (
              <ParamsFields type={type} value={params} onChange={setParams} options={options} idPrefix="na" errors={errors} />
            )}
            <Field label="Why (shown to the approver)" htmlFor="na-why">
              <Input id="na-why" value={explanation} maxLength={500} onChange={(e) => setExplanation(e.target.value)} placeholder="Short reason" />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending || unavailable}
              onClick={() =>
                run(() => staffActionAction(requestId, type, cleanParams(type, params), explanation || `${meta.label} by staff`, true), {
                  success: (d) =>
                    d.execution
                      ? d.execution.status === "executed"
                        ? d.execution.summary
                        : null
                      : d.requiresApproval
                        ? "Saved as a draft. Send it for approval when ready."
                        : "Saved.",
                  onSuccess: (d) => {
                    if (d.execution?.status === "failed") toast.error(`Execution failed: ${d.execution.reason}`);
                    setOpen(false);
                    setExplanation("");
                  },
                  onError: (r) => setErrors(r.fieldErrors),
                })
              }
            >
              {pending ? "Saving…" : needsApproval ? "Save as draft" : `${meta.label}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
