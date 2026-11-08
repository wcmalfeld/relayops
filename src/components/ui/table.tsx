import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-left text-[13px]", className)} {...props} />
    </div>
  );
}
export function THead(props: React.ComponentProps<"thead">) {
  return <thead className="border-b border-line bg-sunken/60 text-xs text-muted" {...props} />;
}
export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return <th scope="col" className={cn("px-3 py-2 font-medium whitespace-nowrap first:pl-4 last:pr-4", className)} {...props} />;
}
export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-line last:border-0", className)} {...props} />;
}
export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2.5 align-top first:pl-4 last:pr-4", className)} {...props} />;
}
