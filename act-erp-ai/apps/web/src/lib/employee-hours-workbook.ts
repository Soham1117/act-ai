import { buildPeriodSheet, buildWorkbookXlsx, type WorkbookEntry } from "@/lib/payroll-workbook";

/**
 * One employee's hours for an inclusive business-date range, in the same
 * Period (Detail) layout as the payroll workbook. `entries` should start at
 * the Monday of `from`'s week so weekly overtime counts earlier days.
 */
export function buildEmployeeHoursWorkbook(
  employee: { name: string; salaried: boolean },
  entries: WorkbookEntry[],
  from: string,
  to: string,
): Buffer {
  return buildWorkbookXlsx([
    buildPeriodSheet({
      period: { start: from, end: to },
      entries,
      salariedNames: employee.salaried ? [employee.name] : [],
      notes: new Map(),
    }),
  ]);
}
