import { buildDailySheet } from "@/lib/employee-hours-workbook";
import { buildPeriodSheet, buildWorkbookXlsx, type WorkbookEntry } from "@/lib/payroll-workbook";

/**
 * Contract workers' hours for an inclusive date range, in the same Period
 * (Detail) layout as the payroll workbook. `entries` should start at the
 * Monday of `from`'s week so weekly overtime counts earlier days.
 */
export function buildContractHoursWorkbook(entries: WorkbookEntry[], from: string, to: string): Buffer {
  return buildWorkbookXlsx([
    buildPeriodSheet({ period: { start: from, end: to }, entries, salariedNames: [], notes: new Map() }),
    buildDailySheet(entries, from, to),
  ]);
}
