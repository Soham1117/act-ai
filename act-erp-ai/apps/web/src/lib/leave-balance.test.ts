import { describe, expect, it } from "vitest";
import {
  balanceShortfall,
  computeBalances,
  computeTypeBalance,
  dayWeights,
  earnedForYear,
  findOverlap,
  leaveDaysForRange,
  overdrawnYears,
  parseDateOnly,
  splitDaysByYear,
  type BalanceInput,
  type BalanceRequest,
  type LeavePolicyValues,
} from "./leave-balance";

const d = (s: string) => parseDateOnly(s)!;
const grant = (dpy: number, carry = 0): LeavePolicyValues => ({
  daysPerYear: dpy, unlimited: false, accrualMode: "ANNUAL_GRANT", carryoverMax: carry,
});
const monthly = (dpy: number): LeavePolicyValues => ({
  daysPerYear: dpy, unlimited: false, accrualMode: "MONTHLY", carryoverMax: 0,
});

function input(over: Partial<BalanceInput> = {}): BalanceInput {
  return {
    policies: { ANNUAL: grant(10), SICK: grant(5), BEREAVEMENT: { ...grant(0), unlimited: true } },
    hireDate: d("2020-01-01"),
    adjustments: [],
    requests: [],
    today: d("2026-06-15"),
    ...over,
  };
}
const req = (
  leaveType: string, start: string, end: string,
  status: BalanceRequest["status"] = "APPROVED", extra: Partial<BalanceRequest> = {},
): BalanceRequest => ({ leaveType, startDate: d(start), endDate: d(end), status, ...extra });

describe("parseDateOnly", () => {
  it("accepts valid and rejects impossible dates", () => {
    expect(parseDateOnly("2026-02-28")).not.toBeNull();
    expect(parseDateOnly("2026-02-30")).toBeNull();
    expect(parseDateOnly("26-1-1")).toBeNull();
  });
});

describe("day math", () => {
  it("counts Mon-Fri only (weekend math)", () => {
    // Fri 2026-06-12 .. Mon 2026-06-15 => Fri + Mon
    expect(leaveDaysForRange({ startDate: d("2026-06-12"), endDate: d("2026-06-15") })).toBe(2);
    // Sat-Sun only => 0
    expect(leaveDaysForRange({ startDate: d("2026-06-13"), endDate: d("2026-06-14") })).toBe(0);
    // Full week
    expect(leaveDaysForRange({ startDate: d("2026-06-15"), endDate: d("2026-06-19") })).toBe(5);
  });
  it("excludes holidays", () => {
    const h = new Set(["2026-06-17"]);
    expect(leaveDaysForRange({ startDate: d("2026-06-15"), endDate: d("2026-06-19") }, h)).toBe(4);
  });
  it("half days subtract 0.5 each; single day half = 0.5", () => {
    const base = { startDate: d("2026-06-15"), endDate: d("2026-06-19") };
    expect(leaveDaysForRange({ ...base, startHalfDay: true })).toBe(4.5);
    expect(leaveDaysForRange({ ...base, startHalfDay: true, endHalfDay: true })).toBe(4);
    const one = { startDate: d("2026-06-15"), endDate: d("2026-06-15") };
    expect(leaveDaysForRange(one)).toBe(1);
    expect(leaveDaysForRange({ ...one, startHalfDay: true })).toBe(0.5);
    expect(leaveDaysForRange({ ...one, startHalfDay: true, endHalfDay: true })).toBe(0.5);
  });
  it("half day on a weekend boundary does not subtract", () => {
    // Sat start (half) through Tue: Mon, Tue = 2
    expect(
      leaveDaysForRange({ startDate: d("2026-06-13"), endDate: d("2026-06-16"), startHalfDay: true }),
    ).toBe(2);
  });
  it("weights per-day sum to total", () => {
    const r = { startDate: d("2026-06-15"), endDate: d("2026-06-19"), endHalfDay: true };
    expect(dayWeights(r).map((x) => x.weight)).toEqual([1, 1, 1, 1, 0.5]);
  });
});

describe("year-boundary splitting", () => {
  it("charges each year only for its own days", () => {
    // Mon 2026-12-28 .. Tue 2027-01-05: Dec 28-31 (Mon-Thu=4), Jan 1 Fri, Jan 4-5 => 3
    const m = splitDaysByYear({ startDate: d("2026-12-28"), endDate: d("2027-01-05") });
    expect(m.get(2026)).toBe(4);
    expect(m.get(2027)).toBe(3);
  });
  it("balances reflect split usage", () => {
    const i = input({ requests: [req("ANNUAL", "2026-12-28", "2027-01-05", "PENDING")] });
    expect(computeTypeBalance(i, "ANNUAL", 2026).pending).toBe(4);
    expect(computeTypeBalance(i, "ANNUAL", 2027).pending).toBe(3);
  });
});

describe("accrual", () => {
  it("ANNUAL_GRANT gives full grant, pro-rated in hire year", () => {
    const p = grant(12);
    expect(earnedForYear(p, 2026, d("2020-03-10"), d("2026-06-15"))).toBe(12);
    expect(earnedForYear(p, 2026, d("2026-01-01"), d("2026-06-15"))).toBe(12);
    // Hired Mar 15 => Apr..Dec = 9 months
    expect(earnedForYear(p, 2026, d("2026-03-15"), d("2026-06-15"))).toBe(9);
    // Hired Mar 1 => Mar..Dec = 10 months
    expect(earnedForYear(p, 2026, d("2026-03-01"), d("2026-06-15"))).toBe(10);
    // Before hire year => 0
    expect(earnedForYear(p, 2025, d("2026-03-01"), d("2026-06-15"))).toBe(0);
  });
  it("pro-ration rounds to half days", () => {
    // 10 * 7/12 = 5.83 -> 6.0 ; 10*5/12=4.17 -> 4.0
    expect(earnedForYear(grant(10), 2026, d("2026-05-20"), d("2026-06-15"))).toBe(6);
    expect(earnedForYear(grant(10), 2026, d("2026-07-20"), d("2026-08-15"))).toBe(4);
  });
  it("MONTHLY accrues per completed month up to today", () => {
    const p = monthly(12);
    // June 15: Jan-May completed = 5
    expect(earnedForYear(p, 2026, d("2020-01-01"), d("2026-06-15"))).toBe(5);
    // On the last day of June, June counts
    expect(earnedForYear(p, 2026, d("2020-01-01"), d("2026-06-30"))).toBe(6);
    // Past year = full
    expect(earnedForYear(p, 2025, d("2020-01-01"), d("2026-06-15"))).toBe(12);
    // Future year = 0
    expect(earnedForYear(p, 2027, d("2020-01-01"), d("2026-06-15"))).toBe(0);
  });
  it("MONTHLY is pro-rated from hire month", () => {
    const p = monthly(12);
    // Hired Mar 15 -> accrual starts April; by Jun 15 completed Apr, May = 2
    expect(earnedForYear(p, 2026, d("2026-03-15"), d("2026-06-15"))).toBe(2);
    // Hired Mar 1 -> March counts: Mar, Apr, May = 3
    expect(earnedForYear(p, 2026, d("2026-03-01"), d("2026-06-15"))).toBe(3);
  });
  it("null hire date is treated as long-tenured", () => {
    expect(earnedForYear(grant(10), 2026, null, d("2026-06-15"))).toBe(10);
  });
});

describe("carryover", () => {
  it("carries min(cap, unused prior-year balance)", () => {
    const i = input({
      policies: { ANNUAL: grant(10, 5) },
      requests: [req("ANNUAL", "2025-03-03", "2025-03-05")], // 3 days in 2025
    });
    // 2025 unused = 10 - 3 = 7 -> capped to 5
    expect(computeTypeBalance(i, "ANNUAL", 2026).carryover).toBe(5);
    expect(computeTypeBalance(i, "ANNUAL", 2026).allowed).toBe(15);
  });
  it("carries less than cap when little is unused", () => {
    const i = input({
      policies: { ANNUAL: grant(10, 5) },
      requests: [req("ANNUAL", "2025-03-03", "2025-03-14")], // 10 days
    });
    expect(computeTypeBalance(i, "ANNUAL", 2026).carryover).toBe(0);
    const j = input({
      policies: { ANNUAL: grant(10, 5) },
      requests: [req("ANNUAL", "2025-03-03", "2025-03-12")], // 8 days
    });
    expect(computeTypeBalance(j, "ANNUAL", 2026).carryover).toBe(2);
  });
  it("is use-it-or-lose-it when cap is 0 and never negative", () => {
    const i = input({ requests: [] });
    expect(computeTypeBalance(i, "ANNUAL", 2026).carryover).toBe(0);
    const over = input({
      policies: { ANNUAL: grant(2, 5) },
      requests: [req("ANNUAL", "2025-03-03", "2025-03-07")],
    });
    expect(computeTypeBalance(over, "ANNUAL", 2026).carryover).toBe(0);
  });
  it("no carryover into the hire year", () => {
    const i = input({ policies: { ANNUAL: grant(10, 5) }, hireDate: d("2026-01-01") });
    expect(computeTypeBalance(i, "ANNUAL", 2026).carryover).toBe(0);
  });
});

describe("adjustments and usage", () => {
  it("adds adjustments for the matching year/type only", () => {
    const i = input({
      adjustments: [
        { year: 2026, leaveType: "ANNUAL", days: 2 },
        { year: 2026, leaveType: "ANNUAL", days: -0.5 },
        { year: 2026, leaveType: "SICK", days: 9 },
        { year: 2025, leaveType: "ANNUAL", days: 9 },
      ],
    });
    const b = computeTypeBalance(i, "ANNUAL", 2026);
    expect(b.adjustments).toBe(1.5);
    expect(b.available).toBe(11.5);
  });
  it("counts approved and pending, ignores rejected/cancelled; taken vs upcoming", () => {
    const i = input({
      requests: [
        req("ANNUAL", "2026-06-01", "2026-06-02"), // taken (before today)
        req("ANNUAL", "2026-07-06", "2026-07-07"), // upcoming
        req("ANNUAL", "2026-08-03", "2026-08-03", "PENDING"),
        req("ANNUAL", "2026-09-01", "2026-09-04", "REJECTED"),
        req("ANNUAL", "2026-10-05", "2026-10-09", "CANCELLED"),
      ],
    });
    const b = computeTypeBalance(i, "ANNUAL", 2026);
    expect([b.taken, b.upcoming, b.pending, b.used]).toEqual([2, 2, 1, 5]);
    expect(b.available).toBe(5);
  });
  it("unlimited types have null available and are excluded from totals", () => {
    const i = input({ requests: [req("BEREAVEMENT", "2026-07-06", "2026-07-10")] });
    const b = computeTypeBalance(i, "BEREAVEMENT", 2026);
    expect(b.unlimited).toBe(true);
    expect(b.available).toBeNull();
    const y = computeBalances(i, 2026);
    expect(y.totals.used).toBe(0);
  });
  it("falls back to default policy when no row exists", () => {
    const i = input({ policies: {} });
    expect(computeTypeBalance(i, "SICK", 2026).earned).toBe(5);
    expect(computeTypeBalance(i, "MATERNITY", 2026).unlimited).toBe(true);
  });
});

describe("balance checks", () => {
  it("rejects a request that exceeds available, per year", () => {
    const i = input({ requests: [req("ANNUAL", "2026-07-06", "2026-07-15", "PENDING")] }); // 8
    expect(balanceShortfall(i, "ANNUAL", { startDate: d("2026-08-03"), endDate: d("2026-08-05") })).toMatch(
      /Not enough/,
    );
    expect(balanceShortfall(i, "ANNUAL", { startDate: d("2026-08-03"), endDate: d("2026-08-04") })).toBeNull();
  });
  it("checks each year independently across a boundary", () => {
    const i = input({ policies: { ANNUAL: grant(3) } });
    // 4 days in 2026 > 3
    expect(
      balanceShortfall(i, "ANNUAL", { startDate: d("2026-12-28"), endDate: d("2027-01-05") }),
    ).toMatch(/2026/);
  });
  it("never blocks unlimited types", () => {
    expect(
      balanceShortfall(input(), "BEREAVEMENT", { startDate: d("2026-07-01"), endDate: d("2026-09-30") }),
    ).toBeNull();
  });
  it("overdrawnYears flags negative balances", () => {
    const i = input({
      adjustments: [{ year: 2026, leaveType: "ANNUAL", days: -8 }],
      requests: [req("ANNUAL", "2026-07-06", "2026-07-08", "PENDING")],
    });
    expect(overdrawnYears(i, "ANNUAL", { startDate: d("2026-07-06"), endDate: d("2026-07-08") })).toEqual([2026]);
  });
});

describe("overlap detection", () => {
  const existing = [
    { id: "a", ...req("ANNUAL", "2026-07-06", "2026-07-10", "PENDING") },
    { id: "b", ...req("SICK", "2026-08-03", "2026-08-03", "APPROVED") },
    { id: "c", ...req("SICK", "2026-09-01", "2026-09-30", "REJECTED") },
  ];
  it("detects inclusive overlap of any type", () => {
    expect(findOverlap({ startDate: d("2026-07-10"), endDate: d("2026-07-14") }, existing)?.id).toBe("a");
    expect(findOverlap({ startDate: d("2026-08-03"), endDate: d("2026-08-03") }, existing)?.id).toBe("b");
    expect(findOverlap({ startDate: d("2026-07-01"), endDate: d("2026-07-31") }, existing)?.id).toBe("a");
  });
  it("ignores adjacent, rejected, and excluded requests", () => {
    expect(findOverlap({ startDate: d("2026-07-11"), endDate: d("2026-07-14") }, existing)).toBeNull();
    expect(findOverlap({ startDate: d("2026-09-10"), endDate: d("2026-09-12") }, existing)).toBeNull();
    expect(findOverlap({ startDate: d("2026-07-06"), endDate: d("2026-07-06") }, existing, "a")).toBeNull();
  });
});
