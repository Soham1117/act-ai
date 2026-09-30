import { describe, expect, it } from "vitest";
import {
  MAX_SHIFT_MINUTES,
  businessLocalToDate,
  capShiftEnd,
  computeEntryTotals,
  dateToBusinessLocal,
  intervalsOverlap,
  isStaleShift,
  parseDateOnly,
  startOfBusinessWeek,
  validateEntryTimes,
} from "./time-rules";

const d = (s: string) => new Date(s);

describe("shift length cap", () => {
  it("flags shifts older than 16h as stale", () => {
    const ci = d("2026-03-02T10:00:00Z");
    expect(isStaleShift(ci, d("2026-03-03T01:59:00Z"))).toBe(false);
    expect(isStaleShift(ci, d("2026-03-03T02:01:00Z"))).toBe(true);
  });
  it("caps proposed end at clockIn + 16h", () => {
    const ci = d("2026-03-02T10:00:00Z");
    const r = capShiftEnd(ci, d("2026-03-04T10:00:00Z"));
    expect(r.capped).toBe(true);
    expect(r.end.toISOString()).toBe("2026-03-03T02:00:00.000Z");
    expect(capShiftEnd(ci, d("2026-03-02T18:00:00Z")).capped).toBe(false);
  });
});

describe("computeEntryTotals", () => {
  const ci = d("2026-03-02T14:00:00Z");
  it("subtracts breaks from elapsed time", () => {
    const t = computeEntryTotals({
      clockIn: ci,
      clockOut: d("2026-03-02T22:00:00Z"),
      breaks: [{ startTime: d("2026-03-02T18:00:00Z"), endTime: d("2026-03-02T18:30:00Z") }],
    });
    expect(t.totalBreakMin).toBe(30);
    expect(t.totalWorkMin).toBe(450);
    expect(t.capped).toBe(false);
  });
  it("closes an open break at clock-out", () => {
    const t = computeEntryTotals({
      clockIn: ci,
      clockOut: d("2026-03-02T20:00:00Z"),
      breaks: [{ startTime: d("2026-03-02T19:00:00Z"), endTime: null }],
    });
    expect(t.totalBreakMin).toBe(60);
    expect(t.totalWorkMin).toBe(300);
  });
  it("caps counted minutes at 16h", () => {
    const t = computeEntryTotals({
      clockIn: ci,
      clockOut: d("2026-03-05T14:00:00Z"),
      breaks: [],
    });
    expect(t.capped).toBe(true);
    expect(t.totalWorkMin).toBe(MAX_SHIFT_MINUTES);
  });
  it("never goes negative", () => {
    const t = computeEntryTotals({
      clockIn: ci,
      clockOut: d("2026-03-02T14:10:00Z"),
      breaks: [{ startTime: ci, endTime: d("2026-03-02T15:00:00Z") }],
    });
    expect(t.totalWorkMin).toBe(0);
  });
});

describe("validateEntryTimes", () => {
  const now = d("2026-03-10T12:00:00Z");
  const ci = d("2026-03-09T14:00:00Z");
  it("accepts a normal entry", () => {
    expect(
      validateEntryTimes({ clockIn: ci, clockOut: d("2026-03-09T22:00:00Z"), breaks: [], now }),
    ).toBeNull();
  });
  it("rejects clock-out before clock-in", () => {
    expect(
      validateEntryTimes({ clockIn: ci, clockOut: d("2026-03-09T13:00:00Z"), breaks: [], now }),
    ).toMatch(/after clock-in/);
  });
  it("rejects shifts longer than 16h", () => {
    expect(
      validateEntryTimes({ clockIn: ci, clockOut: d("2026-03-10T08:00:01Z"), breaks: [], now }),
    ).toMatch(/16 hours/);
  });
  it("rejects overlapping and out-of-range breaks", () => {
    const out = d("2026-03-09T22:00:00Z");
    expect(
      validateEntryTimes({
        clockIn: ci,
        clockOut: out,
        breaks: [
          { startTime: d("2026-03-09T16:00:00Z"), endTime: d("2026-03-09T17:00:00Z") },
          { startTime: d("2026-03-09T16:30:00Z"), endTime: d("2026-03-09T17:30:00Z") },
        ],
        now,
      }),
    ).toMatch(/overlap/);
    expect(
      validateEntryTimes({
        clockIn: ci,
        clockOut: out,
        breaks: [{ startTime: d("2026-03-09T21:30:00Z"), endTime: d("2026-03-09T23:00:00Z") }],
        now,
      }),
    ).toMatch(/after clock-out/);
  });
  it("rejects future times", () => {
    expect(
      validateEntryTimes({ clockIn: d("2026-03-11T00:00:00Z"), clockOut: null, breaks: [], now }),
    ).toMatch(/future/);
  });
});

describe("intervalsOverlap", () => {
  it("treats null end as open-ended", () => {
    expect(
      intervalsOverlap(
        { start: d("2026-03-01T10:00:00Z"), end: null },
        { start: d("2026-03-05T10:00:00Z"), end: d("2026-03-05T12:00:00Z") },
      ),
    ).toBe(true);
    expect(
      intervalsOverlap(
        { start: d("2026-03-01T10:00:00Z"), end: d("2026-03-01T12:00:00Z") },
        { start: d("2026-03-01T12:00:00Z"), end: d("2026-03-01T14:00:00Z") },
      ),
    ).toBe(false);
  });
});

describe("business timezone helpers", () => {
  it("converts Central wall time (CST and CDT) to instants", () => {
    expect(businessLocalToDate("2026-01-15T09:00")!.toISOString()).toBe("2026-01-15T15:00:00.000Z");
    expect(businessLocalToDate("2026-07-15T09:00")!.toISOString()).toBe("2026-07-15T14:00:00.000Z");
  });
  it("round-trips", () => {
    const v = "2026-07-15T23:45";
    expect(dateToBusinessLocal(businessLocalToDate(v)!)).toBe(v);
  });
  it("rejects invalid input", () => {
    expect(businessLocalToDate("nope")).toBeNull();
    expect(businessLocalToDate("2026-02-31T10:00")).toBeNull();
  });
  it("finds Monday of the week and parses date-only", () => {
    expect(startOfBusinessWeek(parseDateOnly("2026-03-08")!).toISOString().slice(0, 10)).toBe("2026-03-02");
    expect(startOfBusinessWeek(parseDateOnly("2026-03-02")!).toISOString().slice(0, 10)).toBe("2026-03-02");
    expect(parseDateOnly("2026-02-30")).toBeNull();
  });
});
