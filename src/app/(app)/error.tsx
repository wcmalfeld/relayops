"use client";

import { Button } from "@/components/ui/button";

export default function AppError({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <div className="mx-auto max-w-lg py-16">
      <h1 className="text-xl font-semibold text-ink">This page could not load</h1>
      <p className="mt-1 text-[14px] text-muted">
        The error was recorded on the server{error.digest ? ` (reference ${error.digest})` : ""}. Nothing was changed. Try again, or check that the database is reachable.
      </p>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
