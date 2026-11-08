import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/context";
import { DEMO_SCENARIOS } from "@/server/intake/demo-scenarios";
import { describeAIConfig } from "@/server/ai";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IntakeForm, DemoGenerator } from "./intake-forms";

export const metadata: Metadata = { title: "New request" };

export default async function NewRequestPage() {
  const ctx = await requireUser();
  const ai = describeAIConfig();
  return (
    <>
      <Link href="/requests" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Requests
      </Link>
      <PageHeader title="New request" description="Enter a request received by phone, in person or by email. Integrations call the same intake service through the API." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Manual entry</CardTitle>
              <CardDescription>If the email matches a customer record, the request is linked to that customer.</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <IntakeForm aiLabel={ai.provider === "unavailable" ? "AI provider is unavailable (simulated outage)" : `AI provider: ${ai.provider} (${ai.model})`} />
          </CardBody>
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Demo scenarios</CardTitle>
                <CardDescription>Fictional requests from Summit Cycles customers. Created as demo data in {ctx.businessName}.</CardDescription>
              </div>
            </CardHeader>
            <DemoGenerator scenarios={DEMO_SCENARIOS.map(({ id, title, description }) => ({ id, title, description }))} />
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Other channels</CardTitle>
              </div>
            </CardHeader>
            <CardBody className="flex flex-col gap-2 text-[13px] text-ink-2">
              <p>
                Public form:{" "}
                <Link className="text-accent hover:underline" href={`/intake/${ctx.businessSlug}`}>
                  /intake/{ctx.businessSlug}
                </Link>{" "}
                (when enabled in Settings, rate limited per visitor).
              </p>
              <p>
                Intake API: <code className="font-mono text-xs">POST /api/v1/requests</code> with an API key from Settings. See the README for the payload.
              </p>
              <p className="text-xs text-muted">Email, e-commerce and point-of-sale integrations are not connected in this build.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
