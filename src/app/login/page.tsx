import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserContext } from "@/server/auth/context";
import { LoginForm } from "./login-form";
import { Wordmark } from "@/components/app/brand";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getUserContext()) redirect("/dashboard");
  const showDemo = process.env.NODE_ENV !== "production" || process.env.SHOW_DEMO_ACCOUNTS === "true";
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,560px)]">
      <section className="hidden flex-col justify-between border-r border-line bg-surface px-12 py-10 lg:flex">
        <Wordmark />
        <div className="max-w-[46ch]">
          <p className="text-[28px] font-semibold leading-9 tracking-[-0.015em] text-ink">
            Customer requests in. Reviewed actions out.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            RelayOps reads each request, finds the matching orders, stock and policies, and drafts what to do. Your team approves anything that
            leaves the shop or changes a record.
          </p>
        </div>
        <p className="text-xs text-faint">Demonstration build with fictional data. Message delivery is simulated.</p>
      </section>
      <section className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>
          <h1 className="text-xl font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted">Use your RelayOps account.</p>
          <LoginForm showDemo={showDemo} />
        </div>
      </section>
    </main>
  );
}
