import { describe, expect, it } from "vitest";
import { readSheetRows } from "@/test-utils/read-xlsx";
import { buildContractHoursWorkbook } from "./contract-hours-workbook";

let n = 0;
const entry = (workerId: string, name: string, date: string, totalWorkMin: number) => ({
  id: `c${n++}`,
  employeeId: workerId,
  employeeName: name,
  date,
  clockIn: Date.parse(`${date}T13:00:00Z`),
  totalWorkMin,
  jobCode: "7",
  approvalStatus: "APPROVED",
});

describe("contract hours workbook", () => {
  it("uses the Period (Detail) layout with weekly overtime and control totals", () => {
    const xlsx = buildContractHoursWorkbook(
      [
        entry("w1", "Agency & Co Worker", "2026-11-02", 600),
        entry("w1", "Agency & Co Worker", "2026-11-03", 600),
        entry("w1", "Agency & Co Worker", "2026-11-04", 600),
        entry("w1", "Agency & Co Worker", "2026-11-05", 600),
        entry("w1", "Agency & Co Worker", "2026-11-06", 120),
        entry("w2", "Bo Lee", "2026-11-06", 60),
      ],
      "2026-11-02",
      "2026-11-08",
    );
    expect(readSheetRows(xlsx)).toEqual([
      ["Period (Detail)"],
      ["For the period of 11/2/2026 to 11/8/2026"],
      ["Name", "Week Start", "Hours", "Regular", "Overtime 1"],
      ["Agency & Co Worker", "11/2/2026", "42:00", "40:00", "2:00"],
      ["Totals for Agency & Co Worker:", "", "42:00", "40:00", "2:00"],
      ["Bo Lee", "11/2/2026", "1:00", "1:00", "0:00"],
      ["Totals for Bo Lee:", "", "1:00", "1:00", "0:00"],
      [],
      ["Control Totals:", "", "43:00", "41:00", "2:00"],
    ]);
  });
});
