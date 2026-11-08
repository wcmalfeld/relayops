import { describe, expect, it } from "vitest";
import { returnEligibility, stockStatus } from "@/server/records/policy-rules";
import { canTransitionManually } from "@/server/requests/status";

describe("deterministic policy rules", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  it("computes the return window from delivery date", () => {
    expect(returnEligibility({ status: "delivered", delivered_at: "2026-10-01T00:00:00Z" }, 30, now).status).toBe("eligible");
    expect(returnEligibility({ status: "delivered", delivered_at: "2026-08-01T00:00:00Z" }, 30, now).status).toBe("outside_window");
    expect(returnEligibility({ status: "shipped", delivered_at: null }, 30, now).status).toBe("not_delivered");
    expect(returnEligibility({ status: "cancelled", delivered_at: null }, 30, now).status).toBe("cancelled");
  });
  it("labels stock levels", () => {
    expect(stockStatus(0)).toBe("out_of_stock");
    expect(stockStatus(2)).toBe("low_stock");
    expect(stockStatus(9)).toBe("in_stock");
  });
  it("limits manual status transitions", () => {
    expect(canTransitionManually("needs_review", "completed")).toBe(true);
    expect(canTransitionManually("processing", "completed")).toBe(false);
  });
});
