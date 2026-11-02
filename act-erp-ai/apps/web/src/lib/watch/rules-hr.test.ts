import { describe, expect, it } from "vitest";
import {
  businessDaysBetween,
  evaluateAfterHoursAdmin,
  evaluateClassificationMissing,
  evaluateCompanyRecords,
  evaluateDbSize,
  evaluateEligibilityUpcoming,
  evaluateFilingDeadlines,
  evaluateHandbookUnsigned,
  evaluateI9Late,
  evaluateKioskStale,
  evaluateLargeExports,
  evaluateMissingFields,
  evaluateNoteWithoutStatus,
  evaluateOnboardingStuck,
  evaluatePlaceholders,
  evaluatePlanYearExpired,
  evaluateScheduleGaps,
  evaluateSensitiveDownloads,
  evaluateTempPasswords,
  evaluateTerminatedLogin,
  evaluateUnknownJobCodes,
  evaluateUnreadNotices,
} from "./rules-hr";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("onboarding", () => {
  it("groups stuck items per person and tells HR-side from employee-side", () => {
    const out = evaluateOnboardingStuck([
      { employeeId: "a", name: "Ann", title: "W-4", status: "SUBMITTED", ageDays: 5 },
      { employeeId: "a", name: "Ann", title: "I-9", status: "SUBMITTED", ageDays: 4 },
      { employeeId: "b", name: "Bo", title: "W-4", status: "NOT_STARTED", ageDays: 9 },
      { employeeId: "c", name: "Cy", title: "W-4", status: "NOT_STARTED", ageDays: 1 },
      { employeeId: "d", name: "Di", title: "W-4", status: "ACCEPTED", ageDays: 30 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((f) => f.employeeId === "a")?.likelyCause).toContain("HR review");
  });
  it("counts business days and flags a late I-9", () => {
    expect(businessDaysBetween(d("2026-10-26"), d("2026-10-30"))).toBe(4);
    expect(evaluateI9Late([{ employeeId: "a", name: "Ann", hireDate: d("2026-10-26"), accepted: false }], d("2026-11-02"))).toHaveLength(1);
    expect(evaluateI9Late([{ employeeId: "a", name: "Ann", hireDate: d("2026-10-26"), accepted: true }], d("2026-11-02"))).toHaveLength(0);
    expect(evaluateI9Late([{ employeeId: "a", name: "Ann", hireDate: d("2026-10-30"), accepted: false }], d("2026-11-02"))).toHaveLength(0);
  });
  it("summarises unsigned handbooks after 7 days", () => {
    expect(evaluateHandbookUnsigned([{ employeeId: "a", name: "Ann", ageDays: 8 }, { employeeId: "b", name: "Bo", ageDays: 2 }])).toHaveLength(1);
    expect(evaluateHandbookUnsigned([{ employeeId: "b", name: "Bo", ageDays: 2 }])).toHaveLength(0);
  });
});

describe("benefits", () => {
  it("flags dates inside 30 days only", () => {
    const rows = [
      { employeeId: "a", name: "Ann", benefitType: "MEDICAL", state: "NOT_YET_ELIGIBLE", proposedDate: "2026-11-20" },
      { employeeId: "b", name: "Bo", benefitType: "RETIREMENT_401K", state: "NOT_YET_ELIGIBLE", proposedDate: "2027-04-01" },
      { employeeId: "c", name: "Cy", benefitType: "VISION", state: "ELIGIBLE_TO_APPLY", proposedDate: "2026-11-10" },
    ];
    expect(evaluateEligibilityUpcoming(rows, d("2026-11-02")).map((f) => f.employeeId)).toEqual(["a"]);
  });
  it("reports missing classification and expired plan years", () => {
    expect(evaluateClassificationMissing(["Ann"])).toHaveLength(1);
    expect(evaluateClassificationMissing([])).toHaveLength(0);
    expect(evaluatePlanYearExpired([{ planId: "p", planName: "BCBS", planYearEnd: "2025-12-31", enrollments: 3 }])).toHaveLength(1);
    expect(evaluatePlanYearExpired([{ planId: "p", planName: "BCBS", planYearEnd: "2025-12-31", enrollments: 0 }])).toHaveLength(0);
  });
});

describe("accounts", () => {
  it("summarises terminated logins and old temporary passwords", () => {
    expect(evaluateTerminatedLogin(["Ann", "Bo"])[0]?.title).toContain("2 terminated employees still have a login");
    expect(evaluateTempPasswords([{ name: "Ann", ageDays: 9 }, { name: "Bo", ageDays: 2 }])[0]?.title).toContain("1 account");
    expect(evaluateTempPasswords([{ name: "Bo", ageDays: 2 }])).toHaveLength(0);
  });
});

describe("filing deadlines", () => {
  it("flags Q3 941 due Oct 31 two weeks ahead, not earlier", () => {
    expect(evaluateFilingDeadlines(d("2026-10-20")).map((f) => f.fingerprint)).toContain("hr.filing-deadline:941-2026-Q3");
    expect(evaluateFilingDeadlines(d("2026-10-10"))).toHaveLength(0);
  });
  it("sees January deadlines two weeks ahead", () => {
    const keys = evaluateFilingDeadlines(d("2027-01-20")).map((f) => f.fingerprint);
    expect(keys).toContain("hr.filing-deadline:w2-2026");
    expect(keys).toContain("hr.filing-deadline:941-2026-Q4");
  });
});

describe("records and notes", () => {
  it("summarises incomplete company records", () => {
    expect(evaluateCompanyRecords([{ id: "1", title: "941", category: "TAX", versions: 1, latestHasDate: false }, { id: "2", title: "Handbook", category: "H", versions: 1, latestHasDate: true }])[0]?.detail).toContain("941");
    expect(evaluateCompanyRecords([{ id: "2", title: "Handbook", category: "H", versions: 1, latestHasDate: true }])).toHaveLength(0);
  });
  it("flags termination notes on active people", () => {
    expect(evaluateNoteWithoutStatus([{ employeeId: "a", name: "Ann", kind: "RESIGNATION", noteDate: "2026-10-30" }])).toHaveLength(1);
  });
  it("needs 5 unread to count", () => {
    expect(evaluateUnreadNotices([{ name: "Ann", unread: 9 }, { name: "Bo", unread: 2 }])[0]?.detail).toContain("Ann (9)");
    expect(evaluateUnreadNotices([{ name: "Bo", unread: 2 }])).toHaveLength(0);
  });
});

describe("data quality", () => {
  it("reports each missing field once", () => {
    const rows = [
      { name: "Ann", departmentId: null, workLocation: "HOUSTON", supervisorId: null },
      { name: "Bo", departmentId: "d", workLocation: null, supervisorId: null },
    ];
    expect(evaluateMissingFields(rows).map((f) => f.fingerprint)).toEqual(["data.missing-fields:department", "data.missing-fields:location", "data.missing-fields:supervisor"]);
    expect(evaluateMissingFields([{ name: "A", departmentId: "d", workLocation: "x", supervisorId: "s" }])).toHaveLength(0);
  });
  it("flags unknown job codes, placeholders and schedule gaps", () => {
    expect(evaluateUnknownJobCodes([{ code: "OLD", entries: 4 }])[0]?.detail).toContain("OLD (4 entries)");
    expect(evaluatePlaceholders([{ name: "Ann", gender: "OTHER" }, { name: "Bo", gender: "MALE" }])[0]?.detail).toContain("Ann");
    expect(evaluateScheduleGaps(["Ann"])).toHaveLength(1);
    expect(evaluateScheduleGaps([])).toHaveLength(0);
  });
});

describe("security and system", () => {
  const row = (action: string, hourLocal: number, actor = "a@x.com") => ({ actor, action, hourLocal, at: new Date("2026-11-02T03:00:00Z") });
  it("counts only late-night admin actions", () => {
    expect(evaluateAfterHoursAdmin([row("employee.update", 23), row("employee.update", 2, "b@x.com"), row("employee.update", 14)])[0]?.title).toContain("2 admin actions");
    expect(evaluateAfterHoursAdmin([row("employee.update", 14)])).toHaveLength(0);
  });
  it("lists exports and heavy downloaders", () => {
    expect(evaluateLargeExports([row("hours.period_export", 10), row("employee.update", 10)])).toHaveLength(1);
    const downloads = Array.from({ length: 10 }, () => row("company.document.download", 10));
    expect(evaluateSensitiveDownloads(downloads)).toHaveLength(1);
    expect(evaluateSensitiveDownloads(downloads.slice(0, 9))).toHaveLength(0);
  });
  it("flags idle kiosks and a large database", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    expect(evaluateKioskStale([{ id: "k", label: "Dock", lastUsedAt: new Date("2026-10-25T12:00:00Z") }, { id: "j", label: "Gate", lastUsedAt: new Date("2026-11-02T10:00:00Z") }], now)).toHaveLength(1);
    expect(evaluateDbSize(12 * 1024 ** 3, 10)).toHaveLength(1);
    expect(evaluateDbSize(2 * 1024 ** 3, 10)).toHaveLength(0);
  });
});
