import { describe, expect, it } from "vitest";
import {
  allocateWeeklyOvertime,
  csvCell,
  csvRow,
  isoWeekEnd,
  isoWeekStart,
  type SlipEntry,
} from "./payroll-overtime";

const h = (n: number) => n * 60;
const day = (date: string, hours: number, clockIn = 0): SlipEntry => ({
  date,
  minutes: h(hours),
  clockIn,
});

describe("iso week helpers", () => {
  it("finds Monday and Sunday", () => {
    expect(isoWeekStart("2026-05-13")).toBe("2026-05-11");
    expect(isoWeekEnd("2026-05-13")).toBe("2026-05-17");
    expect(isoWeekStart("2026-05-17")).toBe("2026-05-11");
    expect(isoWeekStart("2026-05-11")).toBe("2026-05-11");
  });
});

describe("allocateWeeklyOvertime", () => {
  it("week fully inside one period", () => {
    const entries = ["11", "12", "13", "14", "15"].map((d) => day(`2026-05-${d}`, 9));
    const r = allocateWeeklyOvertime(entries, "2026-05-01", "2026-05-31");
    expect(r.regularMin).toBe(h(40));
    expect(r.overtimeMin).toBe(h(5));
    expect(r.weeks).toHaveLength(1);
  });

  it("exactly 40h has no overtime", () => {
    const entries = ["11", "12", "13", "14", "15"].map((d) => day(`2026-05-${d}`, 8));
    const r = allocateWeeklyOvertime(entries, "2026-05-01", "2026-05-31");
    expect(r.overtimeMin).toBe(0);
    expect(r.regularMin).toBe(h(40));
  });

  it("straddling the 12th: OT goes to the period where it is worked, no double count", () => {
    const entries = [
      day("2026-06-08", 10),
      day("2026-06-09", 10),
      day("2026-06-10", 10),
      day("2026-06-11", 10), // 40h reached by the 11th
      day("2026-06-12", 8),
      day("2026-06-13", 4), // all OT
    ];
    const first = allocateWeeklyOvertime(entries, "2026-06-01", "2026-06-11");
    const second = allocateWeeklyOvertime(entries, "2026-06-12", "2026-06-30");
    expect(first.regularMin).toBe(h(40));
    expect(first.overtimeMin).toBe(0);
    expect(second.regularMin).toBe(0);
    expect(second.overtimeMin).toBe(h(12));
    const whole = allocateWeeklyOvertime(entries, "2026-06-01", "2026-06-30");
    expect(first.regularMin + second.regularMin).toBe(whole.regularMin);
    expect(first.overtimeMin + second.overtimeMin).toBe(whole.overtimeMin);
  });

  it("straddling month end splits consistently", () => {
    const entries = [
      day("2026-03-30", 9),
      day("2026-03-31", 9),
      day("2026-04-01", 9),
      day("2026-04-02", 9),
      day("2026-04-03", 9), // 45h total
    ];
    const march = allocateWeeklyOvertime(entries, "2026-03-01", "2026-03-31");
    const april = allocateWeeklyOvertime(entries, "2026-04-01", "2026-04-30");
    expect(march.regularMin).toBe(h(18));
    expect(march.overtimeMin).toBe(0);
    expect(april.regularMin).toBe(h(22));
    expect(april.overtimeMin).toBe(h(5));
    expect(march.regularMin + april.regularMin).toBe(h(40));
  });

  it("multiple entries per day; an entry crossing the threshold is split", () => {
    const entries = [
      day("2026-05-11", 8, 1),
      day("2026-05-11", 4, 2),
      day("2026-05-12", 8),
      day("2026-05-13", 8),
      day("2026-05-14", 10, 1),
      day("2026-05-14", 2, 2),
    ];
    const r = allocateWeeklyOvertime(entries, "2026-05-01", "2026-05-31");
    expect(r.regularMin + r.overtimeMin).toBe(h(40));
    expect(r.overtimeMin).toBe(0);
    const more = allocateWeeklyOvertime([...entries, day("2026-05-15", 3)], "2026-05-01", "2026-05-31");
    expect(more.overtimeMin).toBe(h(3));
    const crossing = allocateWeeklyOvertime([day("2026-05-11", 38), day("2026-05-12", 5)], "2026-05-01", "2026-05-31");
    expect(crossing.regularMin).toBe(h(40));
    expect(crossing.overtimeMin).toBe(h(3));
  });

  it("entries given out of order are walked chronologically", () => {
    const r = allocateWeeklyOvertime([day("2026-05-15", 10), day("2026-05-11", 30)], "2026-05-01", "2026-05-31");
    expect(r.overtimeMin).toBe(0);
    expect(r.regularMin).toBe(h(40));
  });

  it("DST week (spring forward 2026-03-08) uses calendar days", () => {
    const entries = [
      day("2026-03-02", 8),
      day("2026-03-03", 8),
      day("2026-03-04", 8),
      day("2026-03-05", 8),
      day("2026-03-06", 8),
      day("2026-03-08", 5),
    ];
    const r = allocateWeeklyOvertime(entries, "2026-03-01", "2026-03-15");
    expect(r.weeks).toHaveLength(1);
    expect(r.weeks[0]!.weekStart).toBe("2026-03-02");
    expect(r.weeks[0]!.weekEnd).toBe("2026-03-08");
    expect(r.overtimeMin).toBe(h(5));
  });
});

describe("csv escaping", () => {
  it("quotes every field and doubles quotes", () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(12.5)).toBe('"12.5"');
    expect(csvCell(null)).toBe('""');
  });
  it("neutralises formula injection", () => {
    expect(csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
    expect(csvCell(-3)).toBe('"-3"');
  });
  it("joins rows", () => {
    expect(csvRow(["a", 1])).toBe('"a","1"');
  });
});
