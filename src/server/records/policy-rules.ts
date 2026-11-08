/**
 * Deterministic business-policy decisions. The AI receives the outcome of
 * these functions as facts; it never decides eligibility itself.
 */

export type ReturnEligibility =
  | { status: "eligible"; deadline: Date }
  | { status: "outside_window"; deadline: Date }
  | { status: "not_delivered" }
  | { status: "cancelled" };

export function returnEligibility(
  order: { status: string; delivered_at: Date | string | null },
  windowDays: number,
  now: Date = new Date(),
): ReturnEligibility {
  if (order.status === "cancelled") return { status: "cancelled" };
  if (order.status !== "delivered" || !order.delivered_at) return { status: "not_delivered" };
  const delivered = new Date(order.delivered_at);
  const deadline = new Date(delivered.getTime() + windowDays * 86_400_000);
  return now.getTime() <= deadline.getTime() ? { status: "eligible", deadline } : { status: "outside_window", deadline };
}

export function stockStatus(available: number): "in_stock" | "low_stock" | "out_of_stock" {
  if (available <= 0) return "out_of_stock";
  if (available <= 2) return "low_stock";
  return "in_stock";
}
