import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDateTime(d: Date | string, tz?: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));
}

export function formatDate(d: Date | string, tz?: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(new Date(d));
}

/** "5 min ago", "3 h ago", "2 d ago". Computed on the server at render time. */
export function relativeTime(d: Date | string, now = Date.now()) {
  const diff = Math.max(0, now - new Date(d).getTime());
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function humanize(s: string) {
  const t = s.replace(/[_.]/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
