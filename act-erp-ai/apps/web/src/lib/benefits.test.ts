import { describe, expect, it } from "vitest";
import {
  coverageState,
  isCurrentCoverage,
  resolveCost,
  tierLabel,
  costPeriodLabel,
  utcToday,
} from "./benefits";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const today = utc(2026, 6, 15);

describe("coverageState", () => {
  it("returns 'none' when there is no row at all", () => {
    expect(coverageState(null, null, today)).toBe("none");
  });

  it("returns 'waived' for an explicit WAIVED row regardless of dates", () => {
    const row = { status: "WAIVED" as const, effectiveDate: utc(2026, 1, 1), endDate: null };
    expect(coverageState(row, null, today)).toBe("waived");
  });

  it("returns 'pending' for a future-dated (new-hire waiting period) row", () => {
    const row = { status: "ENROLLED" as const, effectiveDate: utc(2026, 9, 1), endDate: null };
    expect(coverageState(row, null, today)).toBe("pending");
  });

  it("returns 'current' for an in-force row with no end date", () => {
    const row = { status: "ENROLLED" as const, effectiveDate: utc(2026, 1, 1), endDate: null };
    expect(coverageState(row, utc(2026, 12, 31), today)).toBe("current");
  });

  it("returns 'lapsed' once the row's own endDate has passed", () => {
    const row = { status: "ENROLLED" as const, effectiveDate: utc(2025, 1, 1), endDate: utc(2026, 3, 1) };
    expect(coverageState(row, null, today)).toBe("lapsed");
  });

  it("returns 'lapsed' when the plan year has ended and no renewal row exists — never shows last year's numbers as current", () => {
    const row = { status: "ENROLLED" as const, effectiveDate: utc(2025, 1, 1), endDate: null };
    expect(coverageState(row, utc(2025, 12, 31), today)).toBe("lapsed");
  });

  it("treats endDate as an exclusive boundary — coverage ends ON that date, not the day after", () => {
    const row = { status: "ENROLLED" as const, effectiveDate: utc(2026, 1, 1), endDate: today };
    expect(coverageState(row, null, today)).toBe("lapsed");
    expect(isCurrentCoverage(row, today)).toBe(false);
  });
});

describe("isCurrentCoverage", () => {
  it("is true exactly on the effective date", () => {
    const row = { status: "ENROLLED" as const, effectiveDate: today, endDate: null };
    expect(isCurrentCoverage(row, today)).toBe(true);
  });

  it("is false the day before the effective date", () => {
    const row = { status: "ENROLLED" as const, effectiveDate: utc(2026, 6, 16), endDate: null };
    expect(isCurrentCoverage(row, today)).toBe(false);
  });
});

describe("resolveCost", () => {
  const tiers = [
    { tier: "EMPLOYEE_ONLY" as const, employeeCost: 25, employerCost: 400 },
    { tier: "FAMILY" as const, employeeCost: 212.4, employerCost: 900 },
  ];

  it("falls back to the plan's standard tier rate when there is no override", () => {
    const row = { tier: "FAMILY" as const, employeeCostOverride: null, employerCostOverride: null };
    expect(resolveCost(row, tiers)).toEqual({ employeeCost: 212.4, employerCost: 900 });
  });

  it("prefers a non-null override over the standard rate", () => {
    const row = { tier: "FAMILY" as const, employeeCostOverride: 150, employerCostOverride: null };
    expect(resolveCost(row, tiers)).toEqual({ employeeCost: 150, employerCost: 900 });
  });

  it("returns null when waived (no tier)", () => {
    const row = { tier: null, employeeCostOverride: null, employerCostOverride: null };
    expect(resolveCost(row, tiers)).toBeNull();
  });

  it("returns null when the tier has no matching price row — a data gap, not a wrong number", () => {
    const row = { tier: "EMPLOYEE_SPOUSE" as const, employeeCostOverride: null, employerCostOverride: null };
    expect(resolveCost(row, tiers)).toBeNull();
  });
});

describe("labels", () => {
  it("tierLabel renders the 3-tier vs 4-tier distinction correctly", () => {
    expect(tierLabel("EMPLOYEE_PLUS_ONE")).toBe("Employee + 1");
    expect(tierLabel("FAMILY")).toBe("Family");
    expect(tierLabel(null)).toBe("—");
  });

  it("costPeriodLabel always names the period so a currency figure is never bare", () => {
    expect(costPeriodLabel("PER_PAYCHECK")).toBe("per paycheck");
    expect(costPeriodLabel("MONTHLY")).toBe("per month");
    expect(costPeriodLabel("ANNUAL")).toBe("per year");
  });
});

describe("utcToday", () => {
  it("returns a UTC-midnight Date so comparisons never straddle the local-timezone boundary", () => {
    const t = utcToday();
    expect(t.getUTCHours()).toBe(0);
    expect(t.getUTCMinutes()).toBe(0);
    expect(t.getUTCSeconds()).toBe(0);
  });
});
