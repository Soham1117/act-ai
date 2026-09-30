import { describe, expect, it } from "vitest";
import {
  auditDiff,
  checkDateOfBirth,
  checkTerminationDate,
  createsSupervisorCycle,
  parseDateInput,
  readOnlyUntil,
  todayDateString,
} from "./employee-validation";

const now = new Date("2026-06-30T15:00:00Z");

describe("parseDateInput", () => {
  it("parses date-only as UTC midnight", () => {
    expect(parseDateInput("2026-03-05")?.toISOString()).toBe("2026-03-05T00:00:00.000Z");
  });
  it("accepts ISO timestamps", () => {
    expect(parseDateInput("2000-01-01T00:00:00.000Z")).toBeInstanceOf(Date);
  });
  it("rejects garbage and rolled-over dates", () => {
    expect(parseDateInput("banana")).toBeNull();
    expect(parseDateInput("2026-02-31")).toBeNull();
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput(null)).toBeNull();
  });
});

describe("date checks", () => {
  it("DOB must be in the past", () => {
    expect(checkDateOfBirth("1990-05-05", now).ok).toBe(true);
    expect(checkDateOfBirth("2030-01-01", now).ok).toBe(false);
    expect(checkDateOfBirth("1800-01-01", now).ok).toBe(false);
  });
  it("termination can be today or past, not future", () => {
    expect(checkTerminationDate("2026-06-30", now).ok).toBe(true);
    expect(checkTerminationDate("2026-06-01", now).ok).toBe(true);
    expect(checkTerminationDate("2026-07-15", now).ok).toBe(false);
    expect(checkTerminationDate("nope", now).ok).toBe(false);
  });
  it("read-only window ends 60 days after termination", () => {
    expect(readOnlyUntil(new Date("2026-01-01T00:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2026-03-02",
    );
  });
  it("todayDateString uses the business timezone", () => {
    // 02:00 UTC on Jul 1 is still Jun 30 in Chicago.
    expect(todayDateString(new Date("2026-07-01T02:00:00Z"))).toBe("2026-06-30");
  });
});

describe("createsSupervisorCycle", () => {
  const map = new Map<string, string | null>([
    ["a", null],
    ["b", "a"],
    ["c", "b"],
  ]);
  it("rejects self-supervision", () => expect(createsSupervisorCycle("a", "a", map)).toBe(true));
  it("rejects a loop", () => expect(createsSupervisorCycle("a", "c", map)).toBe(true));
  it("allows a valid chain", () => expect(createsSupervisorCycle("c", "a", map)).toBe(false));
});

describe("auditDiff", () => {
  it("records only changes and redacts SSN / DOB", () => {
    const d = auditDiff(
      { jobTitle: "A", ssnLast4: "1234", dateOfBirth: new Date("2000-01-01"), city: "X" },
      { jobTitle: "B", ssnLast4: "9999", dateOfBirth: "2001-01-01", city: "X" },
    );
    expect(d.jobTitle).toEqual({ from: "A", to: "B" });
    expect(d.ssnLast4).toBe("[changed]");
    expect(d.dateOfBirth).toBe("[changed]");
    expect("city" in d).toBe(false);
  });
});
