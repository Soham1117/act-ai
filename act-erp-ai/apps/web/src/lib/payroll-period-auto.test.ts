import { describe, expect, it } from "vitest";
import { planNextPeriods } from "@/lib/payroll-period-auto";

const latest = { start: "2026-10-12", end: "2026-10-25", payDate: "2026-10-29" };

describe("planNextPeriods", () => {
  it("adds the current and the next period, keeping the pay date gap", () => {
    const planned = planNextPeriods(latest, "2026-10-30");
    expect(planned.map((p) => [p.start, p.end, p.payDate])).toEqual([
      ["2026-10-26", "2026-11-08", "2026-11-12"],
      ["2026-11-09", "2026-11-22", "2026-11-26"],
    ]);
    expect(planned[0]!.title).toBe("Pay period 2026-10-26 to 2026-11-08");
  });

  it("does nothing when the calendar is already ahead", () => {
    expect(planNextPeriods(latest, "2026-10-10")).toEqual([]);
  });

  it("catches up after a long gap but stops at the cap", () => {
    const planned = planNextPeriods(latest, "2027-06-01");
    expect(planned).toHaveLength(6);
    expect(planned[1]!.start).toBe("2026-11-09");
  });

  it("refuses to guess from irregular periods", () => {
    expect(planNextPeriods({ start: "2026-10-12", end: "2026-10-30", payDate: "2026-11-03" }, "2026-11-01")).toEqual([]);
    expect(planNextPeriods({ start: "2026-10-13", end: "2026-10-26", payDate: "2026-10-30" }, "2026-11-01")).toEqual([]);
    expect(planNextPeriods({ start: "2026-10-12", end: "2026-10-25", payDate: "2026-10-09" }, "2026-11-01")).toEqual([]);
  });
});
