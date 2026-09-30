import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { DEFAULT_KIOSK_PIN, isDefaultPin, validateNewPin } from "./kiosk-pin";
import { parseKioskIdInput } from "./kiosk-id";
import { clearFailures, isLocked, recordFailure } from "./kiosk-rate-limit";

describe("validateNewPin", () => {
  it("accepts reasonable PINs", () => {
    for (const p of ["4829", "730415", "9081"]) expect(validateNewPin(p)).toBeNull();
  });
  it("rejects default, repeats, runs and patterns", () => {
    for (const p of [DEFAULT_KIOSK_PIN, "0000", "1111", "1234", "4321", "123456", "1212", "123123", "12a4", "123"]) {
      expect(validateNewPin(p), p).not.toBeNull();
    }
  });
});

describe("isDefaultPin", () => {
  it("detects the default via bcrypt compare", async () => {
    const def = await bcrypt.hash(DEFAULT_KIOSK_PIN, 4);
    const other = await bcrypt.hash("4829", 4);
    expect(await isDefaultPin(def)).toBe(true);
    expect(await isDefaultPin(other)).toBe(false);
    expect(await isDefaultPin(null)).toBe(false);
  });
});

describe("parseKioskIdInput", () => {
  it("accepts full ids of any year and bare digits", () => {
    expect(parseKioskIdInput(" emp-2027-0042 ")).toEqual({ kind: "full", id: "EMP-2027-0042" });
    expect(parseKioskIdInput("42")).toEqual({ kind: "digits", digits: "42", padded: "0042" });
    expect(parseKioskIdInput("EMP-2026-")).toEqual({ kind: "empty" });
    expect(parseKioskIdInput("")).toEqual({ kind: "empty" });
  });
});

describe("failure-only limiter", () => {
  it("locks only after recorded failures", () => {
    const k = "t1";
    expect(isLocked(k, 3)).toBe(false);
    recordFailure(k, 60_000);
    recordFailure(k, 60_000);
    expect(isLocked(k, 3)).toBe(false);
    recordFailure(k, 60_000);
    expect(isLocked(k, 3)).toBe(true);
    clearFailures(k);
    expect(isLocked(k, 3)).toBe(false);
  });
});
