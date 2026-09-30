import { describe, expect, it } from "vitest";
import {
  isOvernight,
  shiftDurationMinutes,
  shiftEndDate,
  shiftsOverlap,
} from "./schedule-rules";

describe("overnight shifts", () => {
  it("detects overnight and computes duration", () => {
    expect(isOvernight("22:00", "06:00")).toBe(true);
    expect(isOvernight("08:00", "17:00")).toBe(false);
    expect(shiftDurationMinutes("22:00", "06:00")).toBe(8 * 60);
    expect(shiftDurationMinutes("08:00", "17:00")).toBe(9 * 60);
  });
  it("computes the end date", () => {
    expect(shiftEndDate("2026-03-31", "22:00", "06:00")).toBe("2026-04-01");
    expect(shiftEndDate("2026-03-31", "08:00", "17:00")).toBe("2026-03-31");
  });
});

describe("shiftsOverlap", () => {
  const night = { date: "2026-03-10", startTime: "22:00", endTime: "06:00" };
  it("overlaps the next morning", () => {
    expect(shiftsOverlap(night, { date: "2026-03-11", startTime: "05:00", endTime: "09:00" })).toBe(true);
    expect(shiftsOverlap({ date: "2026-03-11", startTime: "05:00", endTime: "09:00" }, night)).toBe(true);
  });
  it("does not overlap when it ends before the next shift starts", () => {
    expect(shiftsOverlap(night, { date: "2026-03-11", startTime: "06:00", endTime: "14:00" })).toBe(false);
  });
  it("overlaps same-day late shift", () => {
    expect(shiftsOverlap(night, { date: "2026-03-10", startTime: "20:00", endTime: "23:00" })).toBe(true);
  });
  it("does not overlap back-to-back nights", () => {
    expect(shiftsOverlap(night, { date: "2026-03-11", startTime: "22:00", endTime: "06:00" })).toBe(false);
  });
  it("does not overlap previous day day-shift", () => {
    expect(shiftsOverlap(night, { date: "2026-03-09", startTime: "08:00", endTime: "17:00" })).toBe(false);
  });
});
