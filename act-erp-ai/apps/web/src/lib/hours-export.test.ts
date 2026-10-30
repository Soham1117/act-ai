import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { allocateWeeklyOvertime, splitEntryOvertime } from "./payroll-overtime";
import {
  buildHoursExportCsv,
  exportLoadFrom,
  type HoursExportEntry,
  type HoursExportOptions,
} from "./hours-export";
import { effectiveRate } from "./time-rate";

const h = (n: number) => n * 60;
let seq = 0;

function entry(
  date: string,
  hours: number,
  over: Partial<HoursExportEntry> = {},
  employee: Partial<HoursExportEntry["employee"]> = {},
): HoursExportEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    employeeId: "emp1",
    date: new Date(`${date}T00:00:00.000Z`),
    clockIn: new Date(`${date}T13:00:00.000Z`),
    totalWorkMin: h(hours),
    jobCode: "SHOP",
    rate: new Prisma.Decimal("20.00"),
    source: "KIOSK",
    approvalStatus: "APPROVED",
    employee: {
      employeeId: "ACT001",
      name: "Ann",
      exportCode: "ACT001",
      defaultHourlyRate: new Prisma.Decimal("20.00"),
      compensationType: "HOURLY_RATE",
      department: null,
      ...employee,
    },
    ...over,
  };
}

const base: HoursExportOptions = {
  columns: ["date", "jobCode", "rate", "regularHours", "otHours", "totalHours"],
  splitBy: "NONE",
  includeHeader: false,
  includeSalaried: true,
  approvedOnly: true,
  sortOrder: "NAME",
  from: "2026-10-12",
  to: "2026-10-25",
};

const rows = (csv: string) =>
  csv
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split(",").map((c) => c.replace(/^"|"$/g, "")));

describe("splitEntryOvertime", () => {
  it("matches the weekly allocator totals", () => {
    const list = [
      { id: "a", date: "2026-10-12", minutes: h(10), clockIn: 1 },
      { id: "b", date: "2026-10-13", minutes: h(10), clockIn: 1 },
      { id: "c", date: "2026-10-14", minutes: h(10), clockIn: 1 },
      { id: "d", date: "2026-10-15", minutes: h(10), clockIn: 1 },
      { id: "e", date: "2026-10-16", minutes: h(6), clockIn: 1 },
      { id: "f", date: "2026-10-19", minutes: h(8), clockIn: 1 },
    ];
    const per = splitEntryOvertime(list, "2026-10-12", "2026-10-25");
    const alloc = allocateWeeklyOvertime(list, "2026-10-12", "2026-10-25");
    const ot = [...per.values()].reduce((s, v) => s + v.overtimeMin, 0);
    const reg = [...per.values()].reduce((s, v) => s + v.regularMin, 0);
    expect(ot).toBe(alloc.overtimeMin);
    expect(reg).toBe(alloc.regularMin);
    // the 40h line is crossed on Friday, not on the later week's Monday
    expect(per.get("e")).toEqual({ regularMin: 0, overtimeMin: h(6) });
    expect(per.get("f")).toEqual({ regularMin: h(8), overtimeMin: 0 });
  });
});

describe("buildHoursExportCsv overtime", () => {
  it("puts overtime in the week that earned it, not on the latest rows", () => {
    const list = [
      entry("2026-10-12", 10),
      entry("2026-10-13", 10),
      entry("2026-10-14", 10),
      entry("2026-10-15", 10),
      entry("2026-10-16", 6),
      entry("2026-10-19", 8),
    ];
    const out = rows(buildHoursExportCsv(list, base));
    const byDate = new Map(out.map((r) => [r[0], r]));
    expect(byDate.get("2026-10-16")![4]).toBe("6"); // all six hours are OT
    expect(byDate.get("2026-10-19")![4]).toBe("0"); // next week is regular
    expect(byDate.get("2026-10-19")![3]).toBe("8");
  });

  it("counts hours worked earlier in the week when the range starts mid-week", () => {
    // Mon-Thu 40h worked before the range, Fri 4h inside it.
    const list = [
      entry("2026-10-12", 10),
      entry("2026-10-13", 10),
      entry("2026-10-14", 10),
      entry("2026-10-15", 10),
      entry("2026-10-16", 4),
    ];
    const out = rows(buildHoursExportCsv(list, { ...base, from: "2026-10-16", to: "2026-10-18" }));
    expect(out).toHaveLength(1);
    expect(out[0]![4]).toBe("4");
    expect(exportLoadFrom("2026-10-16")).toBe("2026-10-12");
  });

  it("counts pending hours toward the 40h line even when only approved rows are written", () => {
    const list = [
      entry("2026-10-12", 20, { approvalStatus: "PENDING" }),
      entry("2026-10-13", 20),
      entry("2026-10-14", 5),
    ];
    const out = rows(buildHoursExportCsv(list, base));
    const byDate = new Map(out.map((r) => [r[0], r]));
    expect(byDate.has("2026-10-12")).toBe(false);
    expect(byDate.get("2026-10-14")![4]).toBe("5");
  });

  it("never exports rejected hours, with or without approved-only", () => {
    const list = [
      entry("2026-10-12", 8),
      entry("2026-10-13", 8, { approvalStatus: "REJECTED" }),
    ];
    for (const approvedOnly of [true, false]) {
      const out = rows(buildHoursExportCsv(list, { ...base, approvedOnly }));
      expect(out.map((r) => r[0])).toEqual(["2026-10-12"]);
    }
  });

  it("keeps overtime with the right rate when split by rate", () => {
    const list = [
      entry("2026-10-12", 20, { rate: new Prisma.Decimal("20.00") }),
      entry("2026-10-13", 20, { rate: new Prisma.Decimal("20.00") }),
      entry("2026-10-14", 5, { rate: new Prisma.Decimal("30.00") }),
    ];
    const out = rows(buildHoursExportCsv(list, { ...base, splitBy: "RATE" }));
    const rate30 = out.find((r) => r[2] === "30")!;
    expect(rate30[4]).toBe("5");
    const rate20 = out.filter((r) => r[2] === "20");
    expect(rate20.reduce((s, r) => s + Number(r[4]), 0)).toBe(0);
  });
});

describe("effectiveRate", () => {
  it("never invents a rate", () => {
    expect(effectiveRate(null, null)).toBeNull();
    expect(effectiveRate(undefined, undefined)).toBeNull();
    expect(effectiveRate(null, "22.50")).toBe(22.5);
    expect(effectiveRate("18.00", "22.50")).toBe(18);
  });

  it("leaves the rate blank in the export when none exists", () => {
    const e = entry("2026-10-12", 8, {
      rate: null,
      employee: undefined as never,
    });
    e.employee = {
      employeeId: "ACT001",
      name: "Ann",
      exportCode: null,
      defaultHourlyRate: undefined as never,
      compensationType: "HOURLY_RATE",
      department: null,
    };
    const out = rows(buildHoursExportCsv([e], base));
    expect(out[0]![2]).toBe("");
  });
});
