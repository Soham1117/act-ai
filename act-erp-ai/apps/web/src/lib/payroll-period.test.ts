import { describe, expect, it } from "vitest";
import {
  derivePeriodStatus,
  payrollPeriodsOverlap,
  periodState,
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

describe("periodState", () => {
  const today = d("2026-10-30");
  const base = { start: d("2026-10-12"), end: d("2026-10-25"), closedAt: null, pending: 0, open: 0 };

  it("follows the dates until the period is over", () => {
    expect(periodState({ ...base, start: d("2026-11-02"), end: d("2026-11-15") }, today)).toBe("UPCOMING");
    expect(periodState({ ...base, start: d("2026-10-26"), end: d("2026-11-08") }, today)).toBe("CURRENT");
  });

  it("needs review while hours are pending or someone is still clocked in", () => {
    expect(periodState({ ...base, pending: 3 }, today)).toBe("REVIEW");
    expect(periodState({ ...base, open: 1 }, today)).toBe("REVIEW");
  });

  it("is ready once it is over with nothing outstanding", () => {
    expect(periodState(base, today)).toBe("READY");
  });

  it("stays closed whatever else is true", () => {
    const closedAt = new Date("2026-10-28T12:00:00Z");
    expect(periodState({ ...base, closedAt, pending: 5 }, today)).toBe("CLOSED");
    expect(periodState({ ...base, closedAt, start: d("2026-11-02"), end: d("2026-11-15") }, today)).toBe("CLOSED");
  });
});
