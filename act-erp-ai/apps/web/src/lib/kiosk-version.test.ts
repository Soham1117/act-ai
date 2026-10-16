import { describe, expect, it } from "vitest";
import { canAutoReload, isIdle, isKioskBusy, isNewBuild, isStaleActionError, setKioskBusy } from "./kiosk-version";

describe("isNewBuild", () => {
  it("detects a different id", () => expect(isNewBuild("b", "a")).toBe(true));
  it("ignores same, empty, or bad values", () => {
    expect(isNewBuild("a", "a")).toBe(false);
    expect(isNewBuild("", "a")).toBe(false);
    expect(isNewBuild(undefined, "a")).toBe(false);
    expect(isNewBuild("a", undefined)).toBe(false);
  });
});

describe("isIdle", () => {
  it("needs 15 s without input", () => {
    expect(isIdle({ now: 20_000, lastActivity: 6_000, busy: false })).toBe(false);
    expect(isIdle({ now: 21_000, lastActivity: 6_000, busy: false })).toBe(true);
  });
  it("is never idle while busy", () => expect(isIdle({ now: 99_999, lastActivity: 0, busy: true })).toBe(false));
});

describe("isStaleActionError", () => {
  it("matches Next messages", () => {
    expect(isStaleActionError(new Error('Server Action "abc" was not found on the server. Read more'))).toBe(true);
    expect(isStaleActionError(new Error('Failed to find Server Action "x". This request might be from an older or newer deployment.'))).toBe(true);
    expect(isStaleActionError("older or newer deployment")).toBe(true);
    expect(isStaleActionError({ message: "was not found on the server" })).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isStaleActionError(new Error("Network down"))).toBe(false);
    expect(isStaleActionError(null)).toBe(false);
  });
});

describe("canAutoReload", () => {
  it("allows first reload", () => expect(canAutoReload(null, 1000)).toBe(true));
  it("blocks within 30 s", () => expect(canAutoReload(1000, 20_000)).toBe(false));
  it("allows after 30 s", () => expect(canAutoReload(1000, 31_000)).toBe(true));
  it("allows if clock went back", () => expect(canAutoReload(50_000, 1000)).toBe(true));
});

describe("setKioskBusy", () => {
  it("tracks several sources", () => {
    setKioskBusy("a", true);
    setKioskBusy("b", true);
    setKioskBusy("a", false);
    expect(isKioskBusy()).toBe(true);
    setKioskBusy("b", false);
    expect(isKioskBusy()).toBe(false);
  });
});
