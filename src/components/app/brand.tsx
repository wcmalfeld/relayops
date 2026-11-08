export function RelayMark({ className = "size-6" }: { className?: string }) {
  // Two overlapping links: work handed from one person to the next.
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="7" width="12" height="10" rx="5" fill="none" stroke="var(--color-ink)" strokeWidth="2.2" />
      <rect x="10" y="7" width="12" height="10" rx="5" fill="none" stroke="var(--color-accent)" strokeWidth="2.2" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <RelayMark />
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">RelayOps</span>
    </div>
  );
}
