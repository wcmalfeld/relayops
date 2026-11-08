"use client";

import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/app/use-action";
import { runUnresolvedCheckAction } from "@/app/actions/requests";

export function UnresolvedCheckButton() {
  const { pending, run } = useAction();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        run(() => runUnresolvedCheckAction(), {
          success: (d) => (d.flagged ? `Flagged ${d.flagged} unresolved request${d.flagged === 1 ? "" : "s"}.` : "No new unresolved requests to flag."),
        })
      }
    >
      <Clock />
      {pending ? "Checking…" : "Check unresolved"}
    </Button>
  );
}
