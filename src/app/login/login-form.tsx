"use client";

import { useActionState, useRef } from "react";
import { loginAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Notice } from "@/components/app/page-header";

const DEMO = [
  { email: "owner@summitcycles.example", label: "Maya Chen", role: "Owner, Summit Cycles" },
  { email: "service@summitcycles.example", label: "Jordan Reyes", role: "Service lead (member)" },
  { email: "frontdesk@summitcycles.example", label: "Priya Patel", role: "Front desk (member)" },
  { email: "owner@harborkayak.example", label: "Sam Okafor", role: "Owner, Harbor Kayak Co." },
];
const DEMO_PASSWORD = "relayops-demo-2026";

export function LoginForm({ showDemo }: { showDemo: boolean }) {
  const [state, action, pending] = useActionState(loginAction, null);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);

  return (
    <>
      <form action={action} className="mt-6 flex flex-col gap-4">
        {state && !state.ok ? <Notice tone="red">{state.error}</Notice> : null}
        <Field label="Email" htmlFor="email">
          <Input ref={email} id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input ref={password} id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {showDemo ? (
        <div className="mt-8 border-t border-line pt-5">
          <p className="text-[13px] font-medium text-ink-2">Demo accounts</p>
          <p className="mt-0.5 text-xs text-muted">Fills in the form. Password for all: {DEMO_PASSWORD}</p>
          <ul className="mt-3 flex flex-col gap-1">
            {DEMO.map((d) => (
              <li key={d.email}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-sunken"
                  onClick={() => {
                    if (email.current) email.current.value = d.email;
                    if (password.current) password.current.value = DEMO_PASSWORD;
                    password.current?.focus();
                  }}
                >
                  <span className="text-[13px] font-medium text-ink">{d.label}</span>
                  <span className="text-xs text-muted">{d.role}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
