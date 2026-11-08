"use client";

import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { MANUAL_REQUEST_STATUSES, REQUEST_STATUS_LABELS, SERVICE_TYPES, SERVICE_TYPE_LABELS, type ActionType } from "@/lib/domain";
import { formatDateTime, formatMoney } from "@/lib/utils";

export type ActionOptions = {
  team: { user_id: string; full_name: string; title: string | null }[];
  slots: { id: string; starts_at: string; service_type: string; technician_name: string | null }[];
  orders: { id: string; order_number: string; total_cents: number; status: string }[];
  customerId: string | null;
  customerEmail: string | null;
  timezone: string;
};

export type Params = Record<string, unknown>;

export const PARAM_LABELS: Record<string, string> = {
  to_email: "To",
  subject: "Subject",
  body: "Message",
  status: "New status",
  reason: "Reason",
  assignee_user_id: "Assign to",
  customer_id: "Customer",
  bike_description: "Bike",
  issue_summary: "Issue",
  service_type: "Service type",
  appointment_slot_id: "Appointment slot",
  notes: "Notes",
  order_id: "Order",
  amount_cents: "Refund amount",
};

/** Defaults for a new staff-created action of each type. */
export function defaultParams(type: ActionType, o: ActionOptions): Params {
  switch (type) {
    case "draft_customer_response":
      return { to_email: o.customerEmail ?? "", subject: "", body: "" };
    case "update_request_status":
      return { status: "completed", reason: "" };
    case "assign_team_member":
      return { assignee_user_id: o.team[0]?.user_id ?? "" };
    case "add_internal_note":
      return { body: "" };
    case "create_service_request":
      return { customer_id: o.customerId ?? "", bike_description: "", issue_summary: "", service_type: "repair" };
    case "propose_appointment":
      return { appointment_slot_id: o.slots[0]?.id ?? "", customer_id: o.customerId ?? "", service_type: "tune_up", notes: "" };
    case "prepare_refund_request":
      return { order_id: o.orders[0]?.id ?? "", customer_id: o.customerId ?? "", amount_cents: o.orders[0]?.total_cents ?? 0, reason: "" };
  }
}

/** Remove empty optional fields before sending to the server. */
export function cleanParams(type: ActionType, p: Params): Params {
  const out = { ...p };
  if (type === "propose_appointment" && !out.notes) delete out.notes;
  if (type === "prepare_refund_request") out.amount_cents = Math.round(Number(out.amount_cents));
  return out;
}

export function ParamsFields({ type, value, onChange, options, idPrefix, errors }: { type: ActionType; value: Params; onChange: (p: Params) => void; options: ActionOptions; idPrefix: string; errors?: Record<string, string> }) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  const id = (k: string) => `${idPrefix}-${k}`;
  const str = (k: string) => (value[k] === undefined || value[k] === null ? "" : String(value[k]));
  const err = (k: string) => errors?.[k];

  switch (type) {
    case "draft_customer_response":
      return (
        <div className="flex flex-col gap-3">
          <Field label="To" htmlFor={id("to")} hint="Responses can only go to the customer who sent this request." error={err("to_email")}>
            <Input id={id("to")} value={str("to_email")} readOnly className="bg-sunken text-ink-2" />
          </Field>
          <Field label="Subject" htmlFor={id("subject")} error={err("subject")}>
            <Input id={id("subject")} value={str("subject")} maxLength={200} onChange={(e) => set("subject", e.target.value)} />
          </Field>
          <Field label="Message" htmlFor={id("body")} error={err("body")}>
            <Textarea id={id("body")} value={str("body")} maxLength={4000} rows={10} onChange={(e) => set("body", e.target.value)} />
          </Field>
        </div>
      );
    case "update_request_status":
      return (
        <div className="flex flex-col gap-3">
          <Field label="New status" htmlFor={id("status")} error={err("status")}>
            <Select id={id("status")} value={str("status")} onChange={(e) => set("status", e.target.value)}>
              {MANUAL_REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REQUEST_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" htmlFor={id("reason")} error={err("reason")}>
            <Input id={id("reason")} value={str("reason")} maxLength={500} onChange={(e) => set("reason", e.target.value)} />
          </Field>
        </div>
      );
    case "assign_team_member":
      return (
        <Field label="Assign to" htmlFor={id("assignee")} error={err("assignee_user_id")}>
          <Select id={id("assignee")} value={str("assignee_user_id")} onChange={(e) => set("assignee_user_id", e.target.value)}>
            {options.team.map((t) => (
              <option key={t.user_id} value={t.user_id}>
                {t.full_name}
                {t.title ? ` (${t.title})` : ""}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "add_internal_note":
      return (
        <Field label="Note" htmlFor={id("note")} hint="Visible to your team only." error={err("body")}>
          <Textarea id={id("note")} value={str("body")} maxLength={2000} onChange={(e) => set("body", e.target.value)} />
        </Field>
      );
    case "create_service_request":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Bike" htmlFor={id("bike")} error={err("bike_description")}>
            <Input id={id("bike")} value={str("bike_description")} maxLength={200} onChange={(e) => set("bike_description", e.target.value)} />
          </Field>
          <Field label="Issue" htmlFor={id("issue")} error={err("issue_summary")}>
            <Textarea id={id("issue")} value={str("issue_summary")} maxLength={1000} rows={3} onChange={(e) => set("issue_summary", e.target.value)} />
          </Field>
          <ServiceTypeField id={id("type")} value={str("service_type")} onChange={(v) => set("service_type", v)} />
        </div>
      );
    case "propose_appointment":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Appointment slot" htmlFor={id("slot")} error={err("appointment_slot_id")}>
            <Select id={id("slot")} value={str("appointment_slot_id")} onChange={(e) => set("appointment_slot_id", e.target.value)}>
              {options.slots.length === 0 ? <option value="">No open slots</option> : null}
              {options.slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatDateTime(s.starts_at, options.timezone)} ({SERVICE_TYPE_LABELS[s.service_type as keyof typeof SERVICE_TYPE_LABELS] ?? s.service_type}
                  {s.technician_name ? `, ${s.technician_name}` : ""})
                </option>
              ))}
            </Select>
          </Field>
          <ServiceTypeField id={id("type")} value={str("service_type")} onChange={(v) => set("service_type", v)} />
          <Field label="Notes (optional)" htmlFor={id("notes")}>
            <Input id={id("notes")} value={str("notes")} maxLength={500} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
      );
    case "prepare_refund_request":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Order" htmlFor={id("order")} error={err("order_id")}>
            <Select id={id("order")} value={str("order_id")} onChange={(e) => set("order_id", e.target.value)}>
              {options.orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.order_number}, {formatMoney(o.total_cents)}, {o.status.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Refund amount (USD)" htmlFor={id("amount")} hint="Cannot exceed the order total. No money moves; a manager processes it." error={err("amount_cents")}>
            <Input
              id={id("amount")}
              type="number"
              min={0.01}
              step={0.01}
              value={value.amount_cents === undefined ? "" : (Number(value.amount_cents) / 100).toFixed(2)}
              onChange={(e) => set("amount_cents", Math.round(Number(e.target.value) * 100))}
            />
          </Field>
          <Field label="Reason" htmlFor={id("reason")} error={err("reason")}>
            <Textarea id={id("reason")} value={str("reason")} maxLength={1000} rows={3} onChange={(e) => set("reason", e.target.value)} />
          </Field>
        </div>
      );
  }
}

function ServiceTypeField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Service type" htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {SERVICE_TYPES.map((t) => (
          <option key={t} value={t}>
            {SERVICE_TYPE_LABELS[t]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Readable value for a parameter, keeping the raw identifier visible. */
export function formatParam(key: string, value: unknown, labels: Record<string, string>) {
  if (value === null || value === undefined || value === "") return { text: "None" };
  if (key === "amount_cents" && typeof value === "number") return { text: formatMoney(value) };
  if (key === "service_type" && typeof value === "string") return { text: SERVICE_TYPE_LABELS[value as keyof typeof SERVICE_TYPE_LABELS] ?? value };
  if (key === "status" && typeof value === "string") return { text: REQUEST_STATUS_LABELS[value as keyof typeof REQUEST_STATUS_LABELS] ?? value };
  if (typeof value === "string" && /^[0-9a-f-]{36}$/.test(value)) return { text: labels[value] ?? "Unknown record", id: value };
  return { text: String(value) };
}
