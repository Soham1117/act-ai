import { describe, expect, it } from "vitest";
import { allowedActions, applyAction } from "./status";

const now = new Date("2026-11-02T12:00:00Z");

describe("applyAction", () => {
  it("acknowledges an open finding", () => {
    expect(applyAction("OPEN", "ACKNOWLEDGE", now)).toEqual({ status: "ACKNOWLEDGED", snoozeUntil: null });
  });
  it("snoozes for 1 and 7 days", () => {
    expect(applyAction("OPEN", "SNOOZE_1D", now)?.snoozeUntil?.toISOString()).toBe("2026-11-03T12:00:00.000Z");
    expect(applyAction("OPEN", "SNOOZE_7D", now)?.snoozeUntil?.toISOString()).toBe("2026-11-09T12:00:00.000Z");
  });
  it("dismisses and reopens", () => {
    expect(applyAction("OPEN", "DISMISS", now)?.status).toBe("DISMISSED");
    expect(applyAction("DISMISSED", "REOPEN", now)).toEqual({ status: "OPEN", snoozeUntil: null });
  });
  it("rejects actions that do not fit the status", () => {
    expect(applyAction("RESOLVED", "DISMISS", now)).toBeNull();
    expect(applyAction("DISMISSED", "ACKNOWLEDGE", now)).toBeNull();
    expect(allowedActions("RESOLVED")).toEqual([]);
  });
});
