import { describe, expect, it } from "vitest";
import { isCalendarDate, MAX_PAYSTUB_BYTES, MAX_PAYSTUB_PAGES } from "./paystub-batch";

describe("paystub batch bounds", () => {
  it("shares the accepted byte and page limits", () => {
    expect(MAX_PAYSTUB_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_PAYSTUB_PAGES).toBe(200);
  });
  it.each(["2028-02-29", "2026-01-01", "2026-12-31"])(
    "accepts a calendar date: %s",
    (date) => {
      expect(isCalendarDate(date)).toBe(true);
    },
  );
  it.each([
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-1-1",
    "garbage",
    "0000-01-01",
  ])("rejects an invalid calendar date: %s", (date) => {
    expect(isCalendarDate(date)).toBe(false);
  });
});
