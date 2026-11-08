"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!rounded-md !border !border-line !bg-surface !text-ink !shadow-pop !font-sans",
          description: "!text-muted",
          error: "!border-red/30",
        },
      }}
    />
  );
}
