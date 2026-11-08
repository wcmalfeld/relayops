"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/components/app/use-action";
import { updateInventoryAction, updatePolicyAction, updateServiceStatusAction } from "@/app/actions/admin";

export function InventoryEditor({ productId, onHand, reserved, name }: { productId: string; onHand: number; reserved: number; name: string }) {
  const [value, setValue] = useState(String(onHand));
  const { pending, run } = useAction();
  const dirty = Number(value) !== onHand;
  return (
    <form
      className="flex items-center justify-end gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateInventoryAction({ product_id: productId, quantity_on_hand: value }));
      }}
    >
      <Input type="number" min={reserved} value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-20 text-right tabular" aria-label={`On hand for ${name}`} />
      <Button type="submit" size="sm" disabled={!dirty || pending}>
        Save
      </Button>
    </form>
  );
}

const SERVICE_STATUSES = ["open", "scheduled", "in_progress", "awaiting_parts", "completed", "cancelled"];

export function ServiceStatusSelect({ id, status }: { id: string; status: string }) {
  const { pending, run } = useAction();
  return (
    <Select
      value={status}
      disabled={pending}
      aria-label="Service status"
      className="h-8 w-auto text-[13px]"
      onChange={(e) => run(() => updateServiceStatusAction({ service_request_id: id, status: e.target.value }))}
    >
      {SERVICE_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s.replace(/_/g, " ")}
        </option>
      ))}
    </Select>
  );
}

export function PolicyEditor({ id, title, body }: { id: string; title: string; body: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title, body });
  const { pending, run } = useAction();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => { setForm({ title, body }); setOpen(true); }}>
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Edit policy" description="The AI quotes policies from this text. Changes apply to the next processed request." wide>
          <div className="flex flex-col gap-3">
            <Field label="Title" htmlFor={`pt-${id}`}>
              <Input id={`pt-${id}`} value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Policy text" htmlFor={`pb-${id}`}>
              <Textarea id={`pb-${id}`} value={form.body} maxLength={5000} rows={8} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={pending} onClick={() => run(() => updatePolicyAction({ policy_id: id, ...form }), { onSuccess: () => setOpen(false) })}>
              Save policy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
