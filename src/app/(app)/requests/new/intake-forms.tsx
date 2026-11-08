"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { createDemoRequestAction, createRequestAction } from "@/app/actions/requests";

const schema = z.object({
  customer_name: z.string().trim().min(1, "Customer name is required.").max(120),
  customer_email: z.union([z.email("Enter a valid email address."), z.literal("")]),
  customer_phone: z.string().trim().max(40),
  subject: z.string().trim().min(1, "Subject is required.").max(200),
  body: z.string().trim().min(1, "Message is required.").max(8000, "Message is too long."),
  process: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export function IntakeForm({ aiLabel }: { aiLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { register, handleSubmit, formState, setError } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { customer_name: "", customer_email: "", customer_phone: "", subject: "", body: "", process: true },
  });
  const e = formState.errors;

  const onSubmit = (v: FormValues) =>
    start(async () => {
      const { process, ...payload } = v;
      const res = await createRequestAction(payload, process);
      if (!res.ok) {
        toast.error(res.error);
        for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) setError(k as keyof FormValues, { message: msg });
        return;
      }
      toast.success(
        res.data.processed === "failed"
          ? `${res.data.reference} created. AI processing was unavailable; continue manually.`
          : res.data.processed
            ? `${res.data.reference} created and processed.`
            : `${res.data.reference} created.`,
      );
      router.push(`/requests/${res.data.id}`);
    });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer name" htmlFor="customer_name" error={e.customer_name?.message}>
          <Input id="customer_name" aria-invalid={!!e.customer_name} {...register("customer_name")} />
        </Field>
        <Field label="Email" htmlFor="customer_email" error={e.customer_email?.message} hint="Needed to send a reply.">
          <Input id="customer_email" type="email" aria-invalid={!!e.customer_email} {...register("customer_email")} />
        </Field>
      </div>
      <Field label="Phone (optional)" htmlFor="customer_phone" error={e.customer_phone?.message}>
        <Input id="customer_phone" type="tel" {...register("customer_phone")} />
      </Field>
      <Field label="Subject" htmlFor="subject" error={e.subject?.message}>
        <Input id="subject" aria-invalid={!!e.subject} {...register("subject")} />
      </Field>
      <Field label="Message" htmlFor="body" error={e.body?.message}>
        <Textarea id="body" rows={7} aria-invalid={!!e.body} {...register("body")} />
      </Field>
      <label className="flex items-start gap-2 text-[13px] text-ink-2">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" {...register("process")} />
        <span>
          Classify and draft with AI after creating
          <span className="block text-xs text-muted">{aiLabel}</span>
        </span>
      </label>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create request"}
        </Button>
      </div>
    </form>
  );
}

export function DemoGenerator({ scenarios }: { scenarios: { id: string; title: string; description: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-line">
      {scenarios.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">{s.title}</p>
            <p className="text-xs text-muted">{s.description}</p>
          </div>
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(s.id);
              const res = await createDemoRequestAction(s.id);
              setBusy(null);
              if (!res.ok) return toast.error(res.error);
              toast.success(`${res.data.reference} created from the "${s.title}" scenario.`);
              router.push(`/requests/${res.data.id}`);
            }}
          >
            {busy === s.id ? "Creating…" : "Create"}
          </Button>
        </li>
      ))}
    </ul>
  );
}
