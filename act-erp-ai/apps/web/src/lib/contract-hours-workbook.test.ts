import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { buildContractHoursWorkbook, type ContractHoursDay } from "./contract-hours-workbook";

const day = (workerId: string, date: string, workMin: number): ContractHoursDay => ({
  agency: "Agency & Co", workerId, name: "Same name", date,
  clockIn: "8:00 AM", clockOut: "4:00 PM", breakMin: 30, workMin,
  jobCode: "7", approval: "APPROVED",
});

describe("contract hours workbook", () => {
  it("puts totals first, sums days by worker ID, and preserves daily detail", () => {
    const zip = new AdmZip(buildContractHoursWorkbook([
      day("CW-0001", "2026-11-01", 480),
      day("CW-0001", "2026-11-02", 450),
      day("CW-0002", "2026-11-02", 60),
    ], "2026-11-01", "2026-11-02"));
    const workbook = zip.readAsText("xl/workbook.xml");
    expect(workbook.indexOf('name="Worker totals"')).toBeLessThan(workbook.indexOf('name="Daily hours"'));
    const totals = zip.readAsText("xl/worksheets/sheet1.xml");
    const daily = zip.readAsText("xl/worksheets/sheet2.xml");
    expect(totals).toContain('<c r="D4" s="0"><v>15.5</v></c>');
    expect(totals).toContain('<c r="D5" s="0"><v>1</v></c>');
    expect(totals).toContain('<c r="D6" s="1"><v>16.5</v></c>');
    expect(totals).toContain("Agency &amp; Co");
    expect(daily).toContain("2026-11-01");
    expect(daily).toContain("2026-11-02");
    expect(daily).toContain('<c r="H4" s="0"><v>8</v></c>');
    expect(daily).toContain('<c r="H5" s="0"><v>7.5</v></c>');
    expect(daily).toContain('<c r="H7" s="1"><v>16.5</v></c>');
  });
});
