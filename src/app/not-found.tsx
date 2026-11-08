import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-xl font-semibold text-ink">Not found</h1>
      <p className="mt-1 text-[14px] text-muted">That page or record does not exist, or you do not have access to it.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-[14px] text-accent hover:underline">
        Go to the overview
      </Link>
    </main>
  );
}
