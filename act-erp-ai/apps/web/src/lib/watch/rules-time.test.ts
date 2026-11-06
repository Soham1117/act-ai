import { describe, expect, it } from "vitest";
import { holidayName } from "./holidays";
import {
  evaluateContractEntries,
  evaluateContractTenure,
  evaluateDuplicatePunches,
  evaluateEarlyArrival,
  evaluateHolidayWork,
  evaluateImpossibleShifts,
  evaluateLunch,
  evaluateMissingClockIn,
  evaluateNewKiosk,
  evaluateOvertimePace,
  evaluatePhotoMissing,
  evaluateRoundingDrift,
  evaluateScheduleVariance,
  type PunchRow,
} from "./rules-time";
import { DEFAULT_POLICY } from "./types";

const t = (s: string) => new Date(s);
const punch = (o: Partial<PunchRow> = {}): PunchRow => ({
  id: "e1",
  employeeId: "p1",
  name: "Ann Lee",
  date: "2026-10-28",
  clockIn: t("2026-10-28T13:00:00Z"),
  clockOut: t("2026-10-28T21:00:00Z"),
  workMin: 480,
  breakMin: 30,
  source: "KIOSK",
  kioskSlug: "main",
  hasPhotoIn: true,
  hasPhotoOut: true,
  actualIn: null,
  actualOut: null,
  notes: null,
  approvalStatus: "PENDING",
  ...o,
});

describe("holidays", () => {
  it("knows 2026 dates", () => {
    expect(holidayName("2026-11-26")).toBe("Thanksgiving");
    expect(holidayName("2026-05-25")).toBe("Memorial Day");
    expect(holidayName("2026-09-07")).toBe("Labor Day");
    expect(holidayName("2026-12-25")).toBe("Christmas Day");
    expect(holidayName("2026-11-02")).toBeNull();
  });
});

describe("missing clock-in", () => {
  const row = { scheduleId: "s", employeeId: "p1", name: "Ann", start: t("2026-11-02T13:00:00Z"), hasEntry: false, onLeave: false };
  it("flags after 30 minutes", () => {
    expect(evaluateMissingClockIn([row], t("2026-11-02T13:31:00Z"))).toHaveLength(1);
    expect(evaluateMissingClockIn([row], t("2026-11-02T13:20:00Z"))).toHaveLength(0);
  });
  it("skips people who punched or are on leave", () => {
    expect(evaluateMissingClockIn([{ ...row, hasEntry: true }], t("2026-11-02T15:00:00Z"))).toHaveLength(0);
    expect(evaluateMissingClockIn([{ ...row, onLeave: true }], t("2026-11-02T15:00:00Z"))).toHaveLength(0);
  });
});

describe("overtime pace", () => {
  const row = { employeeId: "p1", name: "Ann", weekStart: "2026-11-02", workedMin: 30 * 60, scheduledRemainingMin: 0 };
  it("flags a projection over the line, quiet under it", () => {
    expect(evaluateOvertimePace([{ ...row, scheduledRemainingMin: 12 * 60 }], DEFAULT_POLICY)[0]?.severity).toBe("INFO");
    expect(evaluateOvertimePace([{ ...row, scheduledRemainingMin: 8 * 60 }], DEFAULT_POLICY)).toHaveLength(0);
  });
  it("warns once already over", () => {
    expect(evaluateOvertimePace([{ ...row, workedMin: 41 * 60 }], DEFAULT_POLICY)[0]?.severity).toBe("WARN");
  });
  it("respects an edited overtime line", () => {
    expect(evaluateOvertimePace([{ ...row, scheduledRemainingMin: 6 * 60 }], { ...DEFAULT_POLICY, weeklyOvertimeHours: 35 })).toHaveLength(1);
  });
});

describe("lunch", () => {
  it("flags a long shift with no lunch, and odd lunch lengths", () => {
    expect(evaluateLunch([punch({ breakMin: 0 })], DEFAULT_POLICY)[0]?.fingerprint).toBe("time.break-missing:e1");
    expect(evaluateLunch([punch({ breakMin: 10 })], DEFAULT_POLICY)[0]?.fingerprint).toBe("time.break-length:e1");
    expect(evaluateLunch([punch({ breakMin: 120 })], DEFAULT_POLICY)).toHaveLength(1);
  });
  it("accepts a normal lunch and short shifts", () => {
    expect(evaluateLunch([punch({ breakMin: 30 })], DEFAULT_POLICY)).toHaveLength(0);
    expect(evaluateLunch([punch({ breakMin: 0, workMin: 240 })], DEFAULT_POLICY)).toHaveLength(0);
  });
});

describe("impossible and duplicate shifts", () => {
  it("accepts an approved 17-hour shift but still flags it before approval", () => {
    const long = punch({ clockOut: t("2026-10-29T06:00:00Z"), approvalStatus: "APPROVED" });
    expect(evaluateImpossibleShifts([long], DEFAULT_POLICY)).toEqual([]);
    const findings = evaluateImpossibleShifts([{ ...long, approvalStatus: "PENDING" }], DEFAULT_POLICY);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.fixLink).toBe("/admin/hours?employee=p1&from=2026-10-28&to=2026-10-28");
    expect(findings[0]?.evidence).toMatchObject({ spanMinutes: 1020, approvalStatus: "PENDING" });
  });
  it("accepts exactly 24 approved hours, but still flags longer shifts and overlaps", () => {
    const long = punch({ clockOut: t("2026-10-29T13:00:00Z"), approvalStatus: "APPROVED" });
    expect(evaluateImpossibleShifts([long], DEFAULT_POLICY)).toEqual([]);
    expect(evaluateImpossibleShifts([{ ...long, clockOut: t("2026-10-29T13:01:00Z") }], DEFAULT_POLICY)).toHaveLength(1);
    const other = punch({ id: "overlap", approvalStatus: "APPROVED" });
    expect(evaluateImpossibleShifts([long, other], DEFAULT_POLICY).some((f) => f.fingerprint.startsWith("time.overlap:"))).toBe(true);
  });
  it("ignores rejected entries when checking long shifts and overlaps", () => {
    expect(evaluateImpossibleShifts([punch({ approvalStatus: "REJECTED", clockOut: t("2026-10-29T13:00:00Z") }), punch({ id: "valid" })], DEFAULT_POLICY)).toEqual([]);
  });
  it("flags a shift over the maximum", () => {
    const long = punch({ clockOut: t("2026-10-29T13:00:00Z") });
    expect(evaluateImpossibleShifts([long], DEFAULT_POLICY)[0]?.fingerprint).toBe("time.impossible-shift:e1");
  });
  it("flags overlapping shifts for one person", () => {
    const a = punch({ id: "a" });
    const b = punch({ id: "b", clockIn: t("2026-10-28T15:00:00Z"), clockOut: t("2026-10-28T23:00:00Z") });
    expect(evaluateImpossibleShifts([a, b], DEFAULT_POLICY).some((f) => f.fingerprint === "time.overlap:a:b")).toBe(true);
  });
  it("flags double taps only within 2 minutes", () => {
    const a = punch({ id: "a" });
    expect(evaluateDuplicatePunches([a, punch({ id: "b", clockIn: t("2026-10-28T13:01:00Z") })])).toHaveLength(1);
    expect(evaluateDuplicatePunches([a, punch({ id: "c", clockIn: t("2026-10-28T13:10:00Z") })])).toHaveLength(0);
  });
});

describe("new kiosk", () => {
  const hist = new Map([["p1", { count: 20, kiosks: new Set(["main"]) }]]);
  it("flags a kiosk never used before", () => {
    expect(evaluateNewKiosk([punch({ kioskSlug: "annex" })], hist, DEFAULT_POLICY)).toHaveLength(1);
  });
  it("ignores known kiosks and thin history", () => {
    expect(evaluateNewKiosk([punch()], hist, DEFAULT_POLICY)).toHaveLength(0);
    expect(evaluateNewKiosk([punch({ kioskSlug: "annex" })], new Map([["p1", { count: 2, kiosks: new Set(["main"]) }]]), DEFAULT_POLICY)).toHaveLength(0);
  });
});

describe("photos", () => {
  it("sums missing photos into one flag and skips non-kiosk", () => {
    const out = evaluatePhotoMissing([punch({ id: "a", hasPhotoIn: false }), punch({ id: "b", hasPhotoOut: false }), punch({ id: "c", source: "TCP", hasPhotoIn: false })], "2026-10-26");
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("2 employee kiosk punches");
  });
});

describe("early arrival", () => {
  it("needs the configured number of early days", () => {
    const rows = [1, 2, 3].map((d) => ({ employeeId: "p1", name: "Ann", date: `2026-10-0${d}`, minutesEarly: 25 }));
    expect(evaluateEarlyArrival(rows, DEFAULT_POLICY, "w")).toHaveLength(1);
    expect(evaluateEarlyArrival(rows.slice(0, 2), DEFAULT_POLICY, "w")).toHaveLength(0);
    expect(evaluateEarlyArrival(rows.map((r) => ({ ...r, minutesEarly: 10 })), DEFAULT_POLICY, "w")).toHaveLength(0);
  });
});

describe("rounding drift", () => {
  it("flags one-directional rounding over enough shifts", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      punch({ id: `r${i}`, actualIn: t("2026-10-28T13:04:00Z"), actualOut: t("2026-10-28T20:56:00Z") }),
    );
    expect(evaluateRoundingDrift(rows)).toHaveLength(1);
    expect(evaluateRoundingDrift(rows.slice(0, 5))).toHaveLength(0);
  });
});

describe("holiday work", () => {
  it("flags holiday shifts with no note", () => {
    expect(evaluateHolidayWork([punch({ date: "2026-11-26" })])).toHaveLength(1);
    expect(evaluateHolidayWork([punch({ date: "2026-11-26", notes: "Planned coverage" })])).toHaveLength(0);
    expect(evaluateHolidayWork([punch()])).toHaveLength(0);
  });
});

describe("schedule variance", () => {
  const row = { employeeId: "p1", name: "Ann", weekStart: "2026-10-26", scheduledMin: 40 * 60, workedMin: 33 * 60 };
  it("flags a gap of 4h or more, ignores unscheduled people", () => {
    expect(evaluateScheduleVariance([row], DEFAULT_POLICY)).toHaveLength(1);
    expect(evaluateScheduleVariance([{ ...row, workedMin: 38 * 60 }], DEFAULT_POLICY)).toHaveLength(0);
    expect(evaluateScheduleVariance([{ ...row, scheduledMin: 0 }], DEFAULT_POLICY)).toHaveLength(0);
  });
});

describe("contract rules", () => {
  const base = { id: "c1", workerId: "w1", name: "Bo (contract)", date: "2026-10-28", jobCode: "PACK", workerJobCode: "PACK", hasPhotoIn: true, viaKiosk: true };
  it("flags missing job code, mismatch, and missing photos", () => {
    expect(evaluateContractEntries([{ ...base, jobCode: " " }], "w")[0]?.fingerprint).toBe("contract.jobcode-missing:c1");
    expect(evaluateContractEntries([{ ...base, jobCode: "LOAD" }], "w")[0]?.fingerprint).toBe("contract.jobcode-mismatch:c1");
    expect(evaluateContractEntries([{ ...base, hasPhotoIn: false }], "w")[0]?.fingerprint).toContain("contract.photo-missing");
    expect(evaluateContractEntries([{ ...base, hasPhotoIn: false, viaKiosk: false }], "w")).toHaveLength(0);
    expect(evaluateContractEntries([base], "w")).toHaveLength(0);
  });
  it("flags long tenure at the limit", () => {
    const now = t("2026-11-02T00:00:00Z");
    const w = { id: "w1", name: "Bo", agency: "Acme", startDate: t("2026-07-01T00:00:00Z") };
    expect(evaluateContractTenure([w], DEFAULT_POLICY, now)).toHaveLength(1);
    expect(evaluateContractTenure([{ ...w, startDate: t("2026-10-01T00:00:00Z") }], DEFAULT_POLICY, now)).toHaveLength(0);
  });
});
