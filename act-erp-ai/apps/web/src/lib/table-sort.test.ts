import { describe, expect, it } from "vitest";
import { compareKeys, sortKey } from "@/lib/table-sort";

const order = (values: string[], dir: "asc" | "desc" = "asc") =>
  [...values].sort((a, b) => compareKeys(sortKey(a), sortKey(b), dir));

describe("table sort keys", () => {
  it("sorts money and percentages as numbers, not text", () => {
    expect(order(["$1,000.00", "$25.50", "$9.00"])).toEqual(["$9.00", "$25.50", "$1,000.00"]);
    expect(order(["(12.50)", "3", "-1"])).toEqual(["(12.50)", "-1", "3"]);
    expect(order(["45%", "5%"])).toEqual(["5%", "45%"]);
  });

  it("sorts durations and clock times", () => {
    expect(order(["9:45", "100:00", "24:45"])).toEqual(["9:45", "24:45", "100:00"]);
    expect(order(["03:30 PM", "07:00 AM", "12:15 PM"])).toEqual(["07:00 AM", "12:15 PM", "03:30 PM"]);
  });

  it("sorts dates by calendar order across formats", () => {
    expect(order(["10/9/2026", "9/30/2026", "1/2/2027"])).toEqual(["9/30/2026", "10/9/2026", "1/2/2027"]);
    expect(order(["2026-10-30", "2026-09-01"])).toEqual(["2026-09-01", "2026-10-30"]);
    expect(order(["Oct 30, 2026", "Sep 1, 2026"])).toEqual(["Sep 1, 2026", "Oct 30, 2026"]);
  });

  it("sorts words ignoring case and numbers naturally", () => {
    expect(order(["bravo", "Alpha", "charlie"])).toEqual(["Alpha", "bravo", "charlie"]);
    expect(order(["EMP-2026-0010", "EMP-2026-0002"])).toEqual(["EMP-2026-0002", "EMP-2026-0010"]);
  });

  it("keeps empty cells last in both directions", () => {
    expect(order(["b", "", "a", "—"])).toEqual(["a", "b", "", "—"]);
    expect(order(["b", "", "a"], "desc")).toEqual(["b", "a", ""]);
  });
});
