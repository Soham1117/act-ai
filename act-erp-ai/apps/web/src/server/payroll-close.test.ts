import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { payrollCalendar: { findFirst: vi.fn() }, timeEntry: { findMany: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ db: mocks.database }));

import { closedPeriodMessage, loadPeriodCounts } from "./payroll-close";

const d = (v: string) => new Date(`${v}T00:00:00.000Z`);
beforeEach(() => vi.resetAllMocks());

describe("closedPeriodMessage", () => {
  it("is null when no closed period covers the dates", async () => {
    mocks.database.payrollCalendar.findFirst.mockResolvedValue(null);
    expect(await closedPeriodMessage(d("2026-10-14"))).toBeNull();
    expect(mocks.database.payrollCalendar.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ closedAt: { not: null } }) }),
    );
  });

  it("names the closed period and says how to unlock it", async () => {
    mocks.database.payrollCalendar.findFirst.mockResolvedValue({
      title: "October 3rd Period",
      payPeriodStart: d("2026-10-12"),
      payPeriodEnd: d("2026-10-25"),
    });
    const msg = await closedPeriodMessage(d("2026-10-14"));
    expect(msg).toContain("October 3rd Period");
    expect(msg).toContain("Reopen");
  });

  it("does not query when given no dates", async () => {
    expect(await closedPeriodMessage()).toBeNull();
    expect(mocks.database.payrollCalendar.findFirst).not.toHaveBeenCalled();
  });
});

describe("loadPeriodCounts", () => {
  it("counts pending and open entries inside each period only", async () => {
    mocks.database.timeEntry.findMany.mockResolvedValue([
      { date: d("2026-10-14"), clockOut: new Date(), status: "COMPLETED" },
      { date: d("2026-10-15"), clockOut: new Date(), status: "COMPLETED" },
      { date: d("2026-10-16"), clockOut: null, status: "ACTIVE" },
      { date: d("2026-10-28"), clockOut: new Date(), status: "COMPLETED" },
    ]);
    const counts = await loadPeriodCounts([
      { id: "a", payPeriodStart: d("2026-10-12"), payPeriodEnd: d("2026-10-25") },
      { id: "b", payPeriodStart: d("2026-10-26"), payPeriodEnd: d("2026-11-08") },
    ]);
    expect(counts.get("a")).toEqual({ pending: 2, open: 1 });
    expect(counts.get("b")).toEqual({ pending: 1, open: 0 });
  });
});
