"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/app/page-header";
import { submitPublicRequest } from "@/app/actions/public-intake";

export function PublicIntakeForm({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  if (done !== null) {
    return (
      <Notice tone="accent" title="Thanks, your message was received">
        {done ? `Your reference is ${done}. ` : ""}We will reply by email.
      </Notice>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const input = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
        start(async () => {
          setError(null);
          const res = await submitPublicRequest(slug, input);
          if (res.ok) setDone(res.data.reference ?? "");
          else {
            setError(res.error);
            setFields(res.fieldErrors ?? {});
          }
        });
      }}
    >
      {error ? <Notice tone="red">{error}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your name" htmlFor="p-name" error={fields.customer_name}>
          <Input id="p-name" name="customer_name" required maxLength={120} autoComplete="name" />
        </Field>
        <Field label="Email" htmlFor="p-email" error={fields.customer_email}>
          <Input id="p-email" name="customer_email" type="email" required maxLength={254} autoComplete="email" />
        </Field>
      </div>
      <Field label="Phone (optional)" htmlFor="p-phone" error={fields.customer_phone}>
        <Input id="p-phone" name="customer_phone" type="tel" maxLength={40} autoComplete="tel" />
      </Field>
      <Field label="Subject" htmlFor="p-subject" error={fields.subject}>
        <Input id="p-subject" name="subject" required maxLength={200} />
      </Field>
      <Field label="Message" htmlFor="p-body" error={fields.body}>
        <Textarea id="p-body" name="body" required maxLength={8000} rows={6} />
      </Field>
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="p-website">Website</label>
        <input id="p-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
