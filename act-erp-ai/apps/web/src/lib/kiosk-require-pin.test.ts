import { describe, expect, it } from "vitest";
import { kioskNeedsPin } from "./kiosk-require-pin";

describe("kioskNeedsPin", () => {
  it("is false only when requirePin is explicitly false", () => {
    expect(kioskNeedsPin({ requirePin: false })).toBe(false);
  });
  it("is true when requirePin is true", () => {
    expect(kioskNeedsPin({ requirePin: true })).toBe(true);
  });
  it("fails closed for missing data", () => {
    expect(kioskNeedsPin(null)).toBe(true);
    expect(kioskNeedsPin(undefined)).toBe(true);
    expect(kioskNeedsPin({})).toBe(true);
    expect(kioskNeedsPin({ requirePin: null })).toBe(true);
  });
});
