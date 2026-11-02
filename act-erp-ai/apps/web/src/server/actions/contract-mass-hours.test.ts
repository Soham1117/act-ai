import { describe, expect, it } from "vitest";
import { middleShiftBreak } from "@/lib/contract-workers";

describe("middleShiftBreak", () => {
  it("returns null when break minutes are 0", () => {
    const inAt = new Date("2026-10-01T12:00:00.000Z");
    const outAt = new Date("2026-10-01T20:00:00.000Z");
    expect(middleShiftBreak(inAt, outAt, 0)).toBeNull();
  });

  it("centers the break in the shift", () => {
    const inAt = new Date("2026-10-01T12:00:00.000Z");
    const outAt = new Date("2026-10-01T20:00:00.000Z");
    const brk = middleShiftBreak(inAt, outAt, 30);
    expect(brk).not.toBeNull();
    expect(brk!.endTime.getTime() - brk!.startTime.getTime()).toBe(30 * 60_000);
    const mid = (inAt.getTime() + outAt.getTime()) / 2;
    expect((brk!.startTime.getTime() + brk!.endTime.getTime()) / 2).toBe(mid);
  });
});
