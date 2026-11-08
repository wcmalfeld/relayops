"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/server/errors";

/**
 * Run a server action with pending state and a toast that reports what the
 * server actually returned (never an optimistic success).
 */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run<T>(fn: () => Promise<ActionResult<T>>, opts: { success?: string | ((data: T) => string | null); onSuccess?: (data: T) => void; onError?: (r: Extract<ActionResult<T>, { ok: false }>) => void } = {}) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        const msg = typeof opts.success === "function" ? opts.success(result.data) : (opts.success ?? result.message);
        if (msg) toast.success(msg);
        opts.onSuccess?.(result.data);
        router.refresh();
      } else {
        toast.error(result.error);
        opts.onError?.(result);
      }
    });
  }

  return { pending, run };
}
