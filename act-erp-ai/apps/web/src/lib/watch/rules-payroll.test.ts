import { describe, expect, it } from "vitest";
import {
  evaluateDuplicatePaystubs,
  evaluateEntrySanity,
  evaluateHoursTotalSpike,
  evaluateLeaveCoverage,
  evaluateLeaveOverdrawn,
  evaluateNewHireForms,
  evaluateOvertimeForecast,
  evaluatePeriodGaps,
  evaluateReimbursements,
  evaluateTerminatedWithHours,
  evaluateUnpaidReimbursements,
} from "./rules-payroll";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const t = (s: string) => new Date(s);

describe("hours total spike", () => {
  const prev = [1, 2, 3, 4].map((i) => ({ periodId: `p${i}`, title: `P${i}`, minutes: 3000 * 60 }));
  it("flags a period 10%+ and 20h+ above average", () => {
    expect(evaluateHoursTotalSpike({ periodId: "c", title: "C", minutes: 3400 * 60 }, prev)).toHaveLength(1);
  });
  it("stays quiet for normal or short history", () => {
    expect(evaluateHoursTotalSpike({ periodId: "c", title: "C", minutes: 3100 * 60 }, prev)).toHaveLength(0);
    expect(evaluateHoursTotalSpike({ periodId: "c", title: "C", minutes: 9000 * 60 }, prev.slice(0, 1))).toHaveLength(0);
  });
});

describe("entry sanity", () => {
  const base = {
    id: "e1",
    employeeId: "p1",
    name: "Ann",
    date: "2026-10-28",
    clockIn: t("2026-10-28T13:00:00Z"),
    clockOut: t("2026-10-28T21:00:00Z"),
    workMin: 450,
    breakMin: 30,
    source: "KIOSK",
  };
  it("accepts consistent entries", () => {
    expect(evaluateEntrySanity([base])).toHaveLength(0);
  });
  it("flags zero or negative hours as critical", () => {
    expect(evaluateEntrySanity([{ ...base, workMin: 0 }])[0]?.severity).toBe("CRITICAL");
    const tap = { ...base, workMin: 0, clockOut: t("2026-10-28T13:00:40Z") };
    expect(evaluateEntrySanity([tap])[0]?.severity).toBe("INFO");
    // Rounded to the same minute, but the raw punches were 2 minutes apart: a short tap, not a broken entry.
    const rounded = { ...base, workMin: 0, clockOut: base.clockIn, actualIn: t("2026-10-28T12:56:00Z"), actualOut: t("2026-10-28T12:58:00Z") };
    expect(evaluateEntrySanity([rounded])[0]?.severity).toBe("INFO");
    expect(evaluateEntrySanity([{ ...rounded, actualOut: t("2026-10-28T13:30:00Z") }])[0]?.severity).toBe("CRITICAL");
    expect(evaluateEntrySanity([{ ...base, clockOut: t("2026-10-28T12:00:00Z") }])[0]?.fingerprint).toBe("payroll.entry-zero:e1");
  });
  it("flags totals that do not match, but not for imported TCP rows", () => {
    expect(evaluateEntrySanity([{ ...base, workMin: 400 }])[0]?.fingerprint).toBe("payroll.entry-mismatch:e1");
    expect(evaluateEntrySanity([{ ...base, workMin: 400, source: "TCP" }])).toHaveLength(0);
  });
});

describe("duplicate paystubs", () => {
  const row = { id: "a", employeeId: "p1", name: "Ann", category: "Pay Stub", start: "2026-10-12", end: "2026-10-25", sha: "x" };
  it("flags two documents for one period only", () => {
    expect(evaluateDuplicatePaystubs([row, { ...row, id: "b" }])).toHaveLength(1);
    expect(evaluateDuplicatePaystubs([row, { ...row, id: "b", start: "2026-10-26", end: "2026-11-08" }])).toHaveLength(0);
  });
});

describe("terminated with hours, new hire forms, unpaid reimbursements", () => {
  it("reports each", () => {
    expect(evaluateTerminatedWithHours([{ employeeId: "p", name: "A", terminationDate: "2026-10-01", lastEntryDate: "2026-10-05", entries: 2 }])[0]?.severity).toBe("CRITICAL");
    expect(evaluateNewHireForms([{ employeeId: "p", name: "A", hireDate: "2026-10-20", missing: ["W-4", "I-9"] }])[0]?.title).toContain("W-4 and I-9");
    expect(evaluateNewHireForms([{ employeeId: "p", name: "A", hireDate: "2026-10-20", missing: [] }])).toHaveLength(0);
    expect(evaluateUnpaidReimbursements([{ id: "r", employeeId: "p", name: "A", title: "Boots", approvedDays: 20 }])).toHaveLength(1);
    expect(evaluateUnpaidReimbursements([{ id: "r", employeeId: "p", name: "A", title: "Boots", approvedDays: 5 }])).toHaveLength(0);
  });
});

describe("period gaps", () => {
  const mk = (id: string, s: string, e: string) => ({ id, title: id, start: d(s), end: d(e) });
  it("accepts back-to-back periods", () => {
    expect(evaluatePeriodGaps([mk("a", "2026-10-12", "2026-10-25"), mk("b", "2026-10-26", "2026-11-08")])).toHaveLength(0);
  });
  it("flags a gap and an overlap", () => {
    expect(evaluatePeriodGaps([mk("a", "2026-10-12", "2026-10-25"), mk("b", "2026-10-28", "2026-11-08")])[0]?.title).toContain("2-day gap");
    expect(evaluatePeriodGaps([mk("a", "2026-10-12", "2026-10-25"), mk("b", "2026-10-24", "2026-11-08")])[0]?.title).toContain("overlap");
  });
});

describe("overtime forecast", () => {
  it("sums hours over the line per week", () => {
    const out = evaluateOvertimeForecast("p", "Period", [
      { employeeId: "a", name: "Ann", weekStart: "2026-10-26", minutes: 45 * 60 },
      { employeeId: "a", name: "Ann", weekStart: "2026-11-02", minutes: 42 * 60 },
      { employeeId: "b", name: "Bo", weekStart: "2026-10-26", minutes: 38 * 60 },
    ], 40);
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("7.0h overtime across 1 people");
  });
  it("is silent with no overtime", () => {
    expect(evaluateOvertimeForecast("p", "P", [{ employeeId: "a", name: "A", weekStart: "w", minutes: 30 * 60 }], 40)).toHaveLength(0);
  });
});

describe("leave coverage and balance", () => {
  const req = { requestId: "r", employeeId: "p", name: "Ann", department: "Shipping", start: d("2026-11-10"), end: d("2026-11-12"), headcount: 8, others: [] as Array<{ start: Date; end: Date }> };
  it("flags when too large a share is off", () => {
    const others = [{ start: d("2026-11-11"), end: d("2026-11-11") }, { start: d("2026-11-11"), end: d("2026-11-12") }];
    expect(evaluateLeaveCoverage([{ ...req, others }], 0.25)).toHaveLength(1);
    expect(evaluateLeaveCoverage([req], 0.25)).toHaveLength(0);
    expect(evaluateLeaveCoverage([{ ...req, headcount: 1 }], 0.25)).toHaveLength(0);
  });
  it("reports overdrawn years only", () => {
    expect(evaluateLeaveOverdrawn([{ requestId: "r", employeeId: "p", name: "A", leaveType: "VACATION", years: [2026] }])).toHaveLength(1);
    expect(evaluateLeaveOverdrawn([{ requestId: "r", employeeId: "p", name: "A", leaveType: "VACATION", years: [] }])).toHaveLength(0);
  });
});

describe("reimbursements", () => {
  const r = { id: "1", employeeId: "p", name: "Ann", title: "Boots", amount: "80.00", expenseDate: "2026-10-20", status: "PENDING", receipts: 0 };
  it("flags missing receipts and duplicates, skips rejected", () => {
    expect(evaluateReimbursements([r])[0]?.fingerprint).toBe("reimbursement.no-receipt:1");
    const out = evaluateReimbursements([{ ...r, receipts: 1 }, { ...r, id: "2", receipts: 1 }]);
    expect(out.map((f) => f.fingerprint)).toEqual(["reimbursement.duplicate:1:2"]);
    expect(evaluateReimbursements([{ ...r, status: "REJECTED" }])).toHaveLength(0);
  });
});
