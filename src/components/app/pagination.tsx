import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({ page, pageCount, total, basePath, params }: { page: number; pageCount: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[13px] text-muted">
      <span className="tabular">
        {total} result{total === 1 ? "" : "s"}, page {page} of {pageCount}
      </span>
      <div className="flex gap-1">
        {page > 1 ? (
          <Link href={href(page - 1)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-ink-2 hover:bg-sunken">
            <ChevronLeft className="size-4" /> Previous
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link href={href(page + 1)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-ink-2 hover:bg-sunken">
            Next <ChevronRight className="size-4" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
