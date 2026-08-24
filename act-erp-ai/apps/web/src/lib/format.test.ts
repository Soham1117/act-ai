import { describe, expect, it } from "vitest";
import { formatDateOnly, formatMoneyInput, parseMoneyInput } from "./format";

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

describe("formatMoneyInput", () => {
  it("adds thousands separators while typing", () => {
    expect(formatMoneyInput("60000")).toBe("60,000");
    expect(formatMoneyInput("60000.5")).toBe("60,000.5");
    expect(formatMoneyInput("60000.50")).toBe("60,000.50");
  });

  it("strips non-numeric junk except a single decimal point", () => {
    expect(formatMoneyInput("$60,000")).toBe("60,000");
    expect(formatMoneyInput("abc")).toBe("");
  });

  it("keeps a trailing decimal so the user can type cents", () => {
    expect(formatMoneyInput("60,000.")).toBe("60,000.");
  });
});

describe("parseMoneyInput", () => {
  it("parses comma-formatted money back to a number", () => {
    expect(parseMoneyInput("60,000")).toBe(60000);
    expect(parseMoneyInput("60,000.50")).toBe(60000.5);
  });

  it("returns null for empty / invalid input", () => {
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("  ")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
  });
});
