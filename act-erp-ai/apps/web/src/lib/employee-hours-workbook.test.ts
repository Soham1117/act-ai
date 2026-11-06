import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { buildEmployeeHoursWorkbook } from "./employee-hours-workbook";

const entry = (date: string, work: number, approvalStatus = "APPROVED") => ({
  date: new Date(`${date}T00:00:00Z`),
  clockIn: new Date(`${date}T14:00:00Z`),
  clockOut: new Date(`${date}T18:00:00Z`),
  totalWorkMin: work,
  totalBreakMin: 0,
  jobCode: "7",
  approvalStatus,
});

describe("individual employee hours workbook", () => {
  it("merges days, excludes rejected hours, and writes only the inclusive date range", () => {
    const zip = new AdmZip(
      buildEmployeeHoursWorkbook(
        { employeeId: "EMP-1", name: "Ann & Lee" },
        [
          entry("2026-10-31", 600),
          entry("2026-11-01", 240),
          entry("2026-11-01", 270, "PENDING"),
          entry("2026-11-02", 480, "REJECTED"),
          entry("2026-11-03", 600),
        ],
        "2026-11-01",
        "2026-11-02",
      ),
    );
    const summary = zip.readAsText("xl/worksheets/sheet1.xml");
    const daily = zip.readAsText("xl/worksheets/sheet2.xml");
    expect(zip.readAsText("xl/workbook.xml")).toMatch(
      /name="Employee totals".*name="Daily hours"/,
    );
    expect(summary).toContain("Ann &amp; Lee");
    expect(summary).toContain('<c r="C4" s="0"><v>8.5</v></c>');
    expect(daily).toContain("MIXED");
    expect(daily).toContain("REJECTED");
    expect(daily).toContain('<c r="E5" s="0"><v>0</v></c>');
    expect(daily).toContain('<c r="E6" s="1"><v>8.5</v></c>');
    expect(daily).not.toContain("2026-10-31");
    expect(daily).not.toContain("2026-11-03");
  });

  it("keeps names that look like formulas as text and leaves a running day's clock-out empty", () => {
    const zip = new AdmZip(
      buildEmployeeHoursWorkbook(
        { employeeId: "EMP-1", name: '=HYPERLINK("x")' },
        [
          entry("2026-11-01", 240),
          { ...entry("2026-11-01", 0, "PENDING"), clockOut: null },
        ],
        "2026-11-01",
        "2026-11-01",
      ),
    );
    const summary = zip.readAsText("xl/worksheets/sheet1.xml");
    expect(summary).toContain("=HYPERLINK(&quot;x&quot;)");
    expect(summary).not.toContain("<f>");
    expect(zip.readAsText("xl/worksheets/sheet2.xml")).not.toContain('<c r="C4"');
  });
});
