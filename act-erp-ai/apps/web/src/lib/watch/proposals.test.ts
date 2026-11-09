import { describe, expect, it } from "vitest";
import type { TimeEntry, TimeBreak } from "@prisma/client";
import { proposalEntrySnapshot, scheduledClockOut, snapshotsMatch } from "./proposals";

const day = new Date("2026-11-02T00:00:00Z");
const entry = { date: day, clockIn: new Date("2026-11-02T14:00:00Z") };
const schedule = { id: "schedule", date: day, startTime: "08:00", endTime: "17:00", updatedAt: day };
const now = new Date("2026-11-04T00:00:00Z");

describe("Watch correction evidence", () => {
  it("uses the authoritative Central schedule end", () => {
    expect(scheduledClockOut(entry, [schedule], now)).toEqual({ clockOut: new Date("2026-11-02T23:00:00Z"), scheduleId: "schedule", scheduleUpdatedAt: day.toISOString() });
  });
  it("handles overnight schedules without assuming same-day clock-out", () => {
    expect(scheduledClockOut({ ...entry, clockIn: new Date("2026-11-03T04:00:00Z") }, [{ ...schedule, startTime: "22:00", endTime: "06:00" }], now)?.clockOut.toISOString()).toBe("2026-11-03T12:00:00.000Z");
  });
  it("refuses missing, multiple, future, wrong-date, and invalid schedule evidence", () => {
    expect(scheduledClockOut(entry, [], now)).toBeNull();
    expect(scheduledClockOut(entry, [schedule, { ...schedule, id: "second" }], now)).toBeNull();
    expect(scheduledClockOut(entry, [schedule], new Date("2026-11-02T18:00:00Z"))).toBeNull();
    expect(scheduledClockOut(entry, [{ ...schedule, date: new Date("2026-11-03") }], now)).toBeNull();
    expect(scheduledClockOut(entry, [{ ...schedule, endTime: "invalid" }], now)).toBeNull();
    expect(scheduledClockOut(entry, [{ ...schedule, endTime: "08:00" }], now)).toBeNull();
  });
  it("refuses a schedule unrelated to the clock-in", () => {
    expect(scheduledClockOut({ ...entry, clockIn: new Date("2026-11-02T01:00:00Z") }, [schedule], now)).toBeNull();
    expect(scheduledClockOut({ ...entry, clockIn: new Date("2026-11-03T01:00:00Z") }, [schedule], now)).toBeNull();
  });
  it("refuses ambiguous Central fall-back schedule times", () => {
    const date = new Date("2026-11-01T00:00:00Z");
    expect(scheduledClockOut({ date, clockIn: new Date("2026-11-01T05:00:00Z") }, [{ ...schedule, date, startTime: "00:00", endTime: "01:30" }], now)).toBeNull();
  });
});

describe("Watch proposal version snapshots", () => {
  it("ignores JSONB key order, but detects edits and break changes", () => {
    expect(snapshotsMatch({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(snapshotsMatch({ updatedAt: "v1", breaks: [] }, { updatedAt: "v2", breaks: [] })).toBe(false);
    expect(snapshotsMatch({ breaks: [{ endTime: null }] }, { breaks: [{ endTime: "2026-11-02" }] })).toBe(false);
  });
  it("serializes dates and orders breaks deterministically", () => {
    const first = { id: "a", startTime: day, endTime: null } as TimeBreak;
    const second = { id: "b", startTime: now, endTime: now } as TimeBreak;
    const source = { ...entry, updatedAt: now, breaks: [second, first] } as TimeEntry & { breaks: TimeBreak[] };
    const snap = proposalEntrySnapshot(source);
    expect(snap.clockIn).toBe(entry.clockIn.toISOString());
    expect(snap.updatedAt).toBe(now.toISOString());
    expect(snap.breaks).toEqual([JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second))]);
    expect(source.breaks[0]).toBe(second);
  });
});
