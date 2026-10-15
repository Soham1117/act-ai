import { describe, expect, it } from "vitest";
import {
  derivePeriodStatus,
  payrollPeriodsOverlap,
  validatePeriodDates,
} from "./payroll-period";

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("payroll period overlap", () => {
  it.each([
    ["2026-09-01", "2026-09-14", "2026-09-10", "2026-09-20"],
    ["2026-09-10", "2026-09-20", "2026-09-01", "2026-09-14"],
    ["2026-09-01", "2026-09-30", "2026-09-10", "2026-09-20"],
    ["2026-09-10", "2026-09-20", "2026-09-01", "2026-09-30"],
    ["2026-09-01", "2026-09-14", "2026-09-14", "2026-09-27"],
  ])("rejects inclusive overlap %s..%s with %s..%s", (start, end, otherStart, otherEnd) => {
    expect(payrollPeriodsOverlap(d(start), d(end), d(otherStart), d(otherEnd))).toBe(true);
  });

  it("allows an adjacent period beginning the day after the prior period ends", () => {
    expect(
      payrollPeriodsOverlap(
        d("2026-09-01"),
        d("2026-09-14"),
        d("2026-09-15"),
        d("2026-09-28"),
      ),
    ).toBe(false);
  });
});

describe("existing payroll period behavior", () => {
  it("preserves date validation", () => {
    expect(validatePeriodDates("2026-09-01", "2026-09-14", "2026-09-18")).toEqual({ ok: true });
    expect(validatePeriodDates("2026-09-14", "2026-09-01", "2026-09-18")).toMatchObject({ ok: false });
    expect(validatePeriodDates("2026-09-01", "2026-09-14", "2026-09-10")).toMatchObject({ ok: false });
  });

  it("preserves derived statuses", () => {
    expect(derivePeriodStatus(d("2026-10-01"), d("2026-10-14"), d("2026-09-30"))).toBe("UPCOMING");
    expect(derivePeriodStatus(d("2026-09-01"), d("2026-09-30"), d("2026-09-15"))).toBe("CURRENT");
    expect(derivePeriodStatus(d("2026-09-01"), d("2026-09-14"), d("2026-09-15"))).toBe("COMPLETED");
  });
});
