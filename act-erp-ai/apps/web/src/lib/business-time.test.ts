import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  businessHour,
  instantFromBusinessTime,
  scheduledRange,
  startOfBusinessDay,
  startOfBusinessMonth,
  startOfBusinessWeek,
} from "./business-time";

const iso = (d: Date) => d.toISOString();

describe("business-time", () => {
  it("startOfBusinessDay uses Central midnight (CDT = UTC-5)", () => {
    expect(iso(startOfBusinessDay(new Date("2026-07-15T03:00:00Z")))).toBe("2026-07-14T05:00:00.000Z");
  });
  it("CST midnight is UTC-6", () => {
    expect(iso(startOfBusinessDay(new Date("2026-01-15T05:59:00Z")))).toBe("2026-01-14T06:00:00.000Z");
    expect(iso(startOfBusinessDay(new Date("2026-01-15T06:00:00Z")))).toBe("2026-01-15T06:00:00.000Z");
  });
  it("businessHour", () => {
    expect(businessHour(new Date("2026-07-15T03:30:00Z"))).toBe(22);
    expect(businessHour(new Date("2026-01-15T06:00:00Z"))).toBe(0);
  });
  it("startOfBusinessWeek is Monday", () => {
    expect(iso(startOfBusinessWeek(new Date("2026-07-15T17:00:00Z")))).toBe("2026-07-13T05:00:00.000Z");
    // Sunday evening Central still belongs to the prior Monday week
    expect(iso(startOfBusinessWeek(new Date("2026-07-20T03:00:00Z")))).toBe("2026-07-13T05:00:00.000Z");
  });
  it("week start across spring-forward (2026-03-08)", () => {
    expect(iso(startOfBusinessWeek(new Date("2026-03-11T17:00:00Z")))).toBe("2026-03-09T05:00:00.000Z");
    expect(iso(startOfBusinessWeek(new Date("2026-03-07T17:00:00Z")))).toBe("2026-03-02T06:00:00.000Z");
  });
  it("month start and months back", () => {
    const d = new Date("2026-03-15T12:00:00Z");
    expect(iso(startOfBusinessMonth(d))).toBe("2026-03-01T06:00:00.000Z");
    expect(iso(startOfBusinessMonth(d, 1))).toBe("2026-02-01T06:00:00.000Z");
    expect(iso(startOfBusinessMonth(new Date("2026-01-15T12:00:00Z"), 2))).toBe("2025-11-01T05:00:00.000Z");
  });
  it("addBusinessDays handles DST day lengths", () => {
    const sat = new Date("2026-03-07T18:00:00Z");
    expect(iso(addBusinessDays(sat, 1))).toBe("2026-03-08T06:00:00.000Z");
    expect(iso(addBusinessDays(sat, 2))).toBe("2026-03-09T05:00:00.000Z");
  });
  it("instantFromBusinessTime around DST", () => {
    const gap = instantFromBusinessTime(2026, 3, 8, 2, 30);
    expect(businessHour(gap)).toBe(3);
    expect(iso(instantFromBusinessTime(2026, 11, 1, 1, 30))).toBe("2026-11-01T06:30:00.000Z");
    expect(iso(instantFromBusinessTime(2026, 11, 1, 12, 0))).toBe("2026-11-01T18:00:00.000Z");
  });
  it("scheduledRange day shift", () => {
    const r = scheduledRange(new Date("2026-07-15T00:00:00Z"), "08:00", "16:30")!;
    expect(iso(r.start)).toBe("2026-07-15T13:00:00.000Z");
    expect(iso(r.end)).toBe("2026-07-15T21:30:00.000Z");
  });
  it("scheduledRange overnight rolls end to next day", () => {
    const r = scheduledRange(new Date("2026-07-15T00:00:00Z"), "22:00", "06:00")!;
    expect(iso(r.start)).toBe("2026-07-16T03:00:00.000Z");
    expect(iso(r.end)).toBe("2026-07-16T11:00:00.000Z");
  });
  it("scheduledRange overnight across fall-back", () => {
    const r = scheduledRange(new Date("2026-10-31T00:00:00Z"), "22:00", "06:00")!;
    expect(iso(r.start)).toBe("2026-11-01T03:00:00.000Z");
    expect(iso(r.end)).toBe("2026-11-01T12:00:00.000Z");
  });
  it("rejects invalid times", () => {
    expect(scheduledRange(new Date("2026-07-15T00:00:00Z"), "25:00", "06:00")).toBeNull();
  });
});

import { dateOnlyWeekStart, dateOnlyShortLabel } from "./business-time";

describe("date-only helpers", () => {
  it("week start of a date-only value never shifts by timezone", () => {
    const wed = new Date("2026-07-15T00:00:00Z");
    expect(dateOnlyWeekStart(wed).toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(dateOnlyWeekStart(new Date("2026-07-19T00:00:00Z")).toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(dateOnlyShortLabel(new Date("2026-07-13T00:00:00Z"))).toBe("Jul 13");
  });
});
