import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import {
  buildPeriodSheet,
  buildWorkbookXlsx,
  periodSheetName,
  type WorkbookEntry,
} from "@/lib/payroll-workbook";

let n = 0;
const entry = (employeeId: string, name: string, date: string, minutes: number, jobCode = "2"): WorkbookEntry => ({
  id: `e${n++}`,
  employeeId,
  employeeName: name,
  date,
  clockIn: Date.parse(`${date}T13:00:00Z`),
  totalWorkMin: minutes,
  jobCode,
  approvalStatus: "APPROVED",
});

const period = { start: "2026-09-14", end: "2026-09-27" };

describe("buildPeriodSheet", () => {
  it("writes weekly rows, a totals row and puts leave in its own column", () => {
    const sheet = buildPeriodSheet({
      period,
      entries: [
        entry("a", "Steve Prcin", "2026-09-14", 38 * 60 + 45),
        entry("a", "Steve Prcin", "2026-09-21", 29 * 60 + 30),
        entry("a", "Steve Prcin", "2026-09-22", 8 * 60, "100"),
      ],
      salariedNames: [],
      notes: new Map(),
    });
    expect(sheet.rows[2]!.cells).toEqual(["Name", "Week Start", "Hours", "Regular", "Overtime 1", "PTO", "Notes"]);
    expect(sheet.rows[3]!.cells.slice(0, 6)).toEqual(["Steve Prcin", "9/14/2026", 2325, 2325, 0, 0]);
    // 29:30 worked + 8:00 PTO = 37:30 hours; regular excludes PTO
    expect(sheet.rows[4]!.cells.slice(0, 6)).toEqual(["", "9/21/2026", 2250, 1770, 0, 480]);
    expect(sheet.rows[5]!.cells.slice(0, 6)).toEqual(["Totals for Steve Prcin:", "", 4575, 4095, 0, 480]);
  });

  it("splits weekly overtime past 40 hours and ignores rejected entries", () => {
    const rejected = { ...entry("b", "Raul Quintero", "2026-09-17", 600), approvalStatus: "REJECTED" };
    const sheet = buildPeriodSheet({
      period,
      entries: [
        entry("b", "Raul Quintero", "2026-09-14", 11 * 60),
        entry("b", "Raul Quintero", "2026-09-15", 11 * 60),
        entry("b", "Raul Quintero", "2026-09-16", 11 * 60),
        entry("b", "Raul Quintero", "2026-09-18", 22 * 60 + 30),
        rejected,
      ],
      salariedNames: [],
      notes: new Map(),
    });
    // 55:30 worked: 40:00 regular + 15:30 overtime
    expect(sheet.rows[3]!.cells.slice(0, 5)).toEqual(["Raul Quintero", "9/14/2026", 3330, 2400, 930]);
  });

  it("counts earlier hours of the same week toward overtime and lists salaried staff", () => {
    const sheet = buildPeriodSheet({
      period: { start: "2026-09-16", end: "2026-09-27" },
      entries: [
        entry("c", "Kayla Jimenez", "2026-09-14", 39 * 60), // before the period, same week
        entry("c", "Kayla Jimenez", "2026-09-16", 5 * 60),
      ],
      salariedNames: ["Ken Stokley", "Kayla Jimenez"],
      notes: new Map([["c", "Additional 114.39 for 2nd 401K loan"]]),
    });
    expect(sheet.rows[3]!.cells).toEqual([
      "Kayla Jimenez",
      "9/14/2026",
      300,
      60,
      240,
      "Additional 114.39 for 2nd 401K loan",
    ]);
    expect(sheet.rows.at(-1)!.cells).toEqual(["Ken Stokley", "Salary"]);
    expect(sheet.rows.some((r) => r.cells[0] === "Kayla Jimenez" && r.cells[1] === "Salary")).toBe(false);
  });
});

describe("buildWorkbookXlsx", () => {
  it("names sheets like the HR file and produces a valid package", () => {
    expect(periodSheetName(period)).toBe("09.14.26 to 09.27.26");
    const buf = buildWorkbookXlsx([
      buildPeriodSheet({ period, entries: [entry("a", "A & B <Test>", "2026-09-14", 60)], salariedNames: [], notes: new Map() }),
    ]);
    const names = new AdmZip(buf).getEntries().map((e) => e.entryName);
    expect(names).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml"]),
    );
    const sheet = new AdmZip(buf).readAsText("xl/worksheets/sheet1.xml");
    expect(sheet).toContain("A &amp; B &lt;Test&gt;");
    expect(new AdmZip(buf).readAsText("xl/workbook.xml")).toContain('name="09.14.26 to 09.27.26"');
  });
});
