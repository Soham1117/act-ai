import { describe, expect, it } from "vitest";
import { formatDateOnly } from "./format";

describe("formatDateOnly", () => {
  it("renders a UTC-midnight @db.Date as the same calendar day regardless of the runner's local timezone", () => {
    // Postgres `date` comes back as a JS Date at UTC midnight. A naive
    // toLocaleDateString() in any zone west of UTC (all of the US,
    // including US/Central) would render Dec 31 here instead — which for a
    // coverage effective date reads as a legal error.
    const jan1 = new Date(Date.UTC(2026, 0, 1));
    expect(formatDateOnly(jan1)).toBe("Jan 1, 2026");
  });

  it("accepts an ISO date string the same way", () => {
    expect(formatDateOnly("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("returns an em dash for null/undefined", () => {
    expect(formatDateOnly(null)).toBe("—");
    expect(formatDateOnly(undefined)).toBe("—");
  });
});
