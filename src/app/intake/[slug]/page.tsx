import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicIntakeContext } from "@/server/intake/channels";
import { PublicIntakeForm } from "./public-form";
import { RelayMark } from "@/components/app/brand";

export const metadata: Metadata = { title: "Contact us" };

export default async function PublicIntakePage({ params }: PageProps<"/intake/[slug]">) {
  const { slug } = await params;
  const resolved = await publicIntakeContext(slug);
  if (!resolved) notFound();
  return (
    <main className="mx-auto max-w-xl px-4 py-10 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-[-0.01em] text-ink">Contact {resolved.businessName}</h1>
      <p className="mt-1 text-[14px] text-muted">Ask about an order, a repair, stock, or book a service. A member of the team reads every message.</p>
      <div className="mt-6 rounded-lg border border-line bg-surface p-5 shadow-raise">
        <PublicIntakeForm slug={slug} />
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-faint">
        <RelayMark className="size-4" /> Handled with RelayOps. Demo form; do not enter real personal information.
      </p>
    </main>
  );
}
