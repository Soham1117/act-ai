import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { readSheetRows } from "@/test-utils/read-xlsx";
import { buildEmployeeHoursWorkbook } from "./employee-hours-workbook";

let n = 0;
const entry = (date: string, work: number, approvalStatus = "APPROVED", jobCode = "7") => ({
  id: `e${n++}`,
  employeeId: "emp",
  employeeName: "Ann & Lee",
  date,
  clockIn: Date.parse(`${date}T14:00:00Z`),
  totalWorkMin: work,
  jobCode,
  approvalStatus,
});

describe("individual employee hours workbook", () => {
  it("uses the Period (Detail) layout for the inclusive range, excluding rejected hours", () => {
    const xlsx = buildEmployeeHoursWorkbook(
      { name: "Ann & Lee", salaried: false },
      [
        entry("2026-10-26", 35 * 60), // same week, before the range: counts toward overtime
        entry("2026-11-01", 240),
        entry("2026-11-01", 270, "PENDING"),
        entry("2026-11-02", 480, "REJECTED"),
        entry("2026-11-03", 480, "APPROVED", "100"),
        entry("2026-11-10", 600), // after the range
      ],
      "2026-11-01",
      "2026-11-03",
    );
    expect(new AdmZip(xlsx).readAsText("xl/workbook.xml")).toContain('name="11.01.26 to 11.03.26"');
    expect(readSheetRows(xlsx)).toEqual([
      ["Period (Detail)"],
      ["For the period of 11/1/2026 to 11/3/2026"],
      ["Name", "Week Start", "Hours", "Regular", "Overtime 1", "PTO"],
      ["Ann & Lee", "10/26/2026", "8:30", "5:00", "3:30", "0:00"],
      ["", "11/2/2026", "8:00", "0:00", "0:00", "8:00"],
      ["Totals for Ann & Lee:", "", "16:30", "5:00", "3:30", "8:00"],
      [],
      ["Control Totals:", "", "16:30", "5:00", "3:30", "8:00"],
    ]);
  });

  it("adds a Daily Times sheet with one row per day and clock in/out", () => {
    const xlsx = buildEmployeeHoursWorkbook(
      { name: "Ann & Lee", salaried: false },
      [
        { ...entry("2026-11-01", 240), clockOut: Date.parse("2026-11-01T18:00:00Z") },
        { ...entry("2026-11-01", 60), clockIn: Date.parse("2026-11-01T19:00:00Z"), clockOut: Date.parse("2026-11-01T20:00:00Z") },
        entry("2026-11-03", 480, "APPROVED", "100"),
      ],
      "2026-11-01",
      "2026-11-03",
    );
    const zip = new AdmZip(xlsx);
    expect(zip.readAsText("xl/workbook.xml")).toContain('name="Daily Times"');
    const sheet = zip.readAsText("xl/worksheets/sheet2.xml");
    expect(sheet).toContain("Sun");
    expect(sheet).toContain("11/3/2026");
    expect(sheet).toContain("Totals for Ann &amp; Lee:");
    const rows = readSheetRows(xlsx, 2);
    expect(rows.at(-1)).toEqual(["Control Totals:", "", "", "", "", "5:00", "5:00", "0:00", "8:00", "13:00"]);
    expect(sheet).toContain("8:00 AM"); // 14:00Z = 8:00 AM Chicago (CST)
    expect(sheet).toContain("2:00 PM"); // last clock out 20:00Z
  });

  it("keeps names that look like formulas as text and lists a salaried employee with no hours", () => {
    const xlsx = buildEmployeeHoursWorkbook(
      { name: '=HYPERLINK("x")', salaried: true },
      [{ ...entry("2026-11-01", 0, "REJECTED"), employeeName: '=HYPERLINK("x")' }],
      "2026-11-01",
      "2026-11-01",
    );
    const sheet = new AdmZip(xlsx).readAsText("xl/worksheets/sheet1.xml");
    expect(sheet).toContain("=HYPERLINK(&quot;x&quot;)");
    expect(sheet).not.toContain("<f>");
    expect(readSheetRows(xlsx).slice(3)).toEqual([['=HYPERLINK("x")', "Salary"], [], ["Control Totals:", "", "0:00", "0:00", "0:00"]]);
  });
});
