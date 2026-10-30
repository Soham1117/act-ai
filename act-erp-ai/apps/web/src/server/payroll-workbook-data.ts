import { db } from "@/lib/db";
import { dateOnlyToString } from "@/lib/time-rules";
import { loadHoursExportEntries } from "@/server/hours-export-data";
import {
  buildPeriodSheet,
  buildWorkbookXlsx,
  type SheetModel,
  type WorkbookEntry,
} from "@/lib/payroll-workbook";

/** The selected pay period plus up to `count - 1` earlier ones, newest first. */
export async function loadPayrollWorkbook(periodId: string, count: number) {
  const selected = await db.payrollCalendar.findUnique({ where: { id: periodId } });
  if (!selected) return null;
  const periods = await db.payrollCalendar.findMany({
    where: { payPeriodEnd: { lte: selected.payPeriodEnd } },
    orderBy: { payPeriodEnd: "desc" },
    take: Math.min(Math.max(count, 1), 6),
  });

  const salaried = await db.employee.findMany({
    where: { employmentStatus: "ACTIVE", compensationType: { not: "HOURLY_RATE" } },
    select: { name: true },
  });
  const salariedNames = salaried.map((s) => s.name);

  const sheets: SheetModel[] = [];
  let pendingCount = 0;
  for (const p of periods) {
    const start = dateOnlyToString(p.payPeriodStart);
    const end = dateOnlyToString(p.payPeriodEnd);
    const raw = await loadHoursExportEntries(start, end);
    const entries: WorkbookEntry[] = raw.map((e) => ({
      id: e.id,
      employeeId: e.employeeId,
      date: dateOnlyToString(e.date),
      clockIn: e.clockIn.getTime(),
      totalWorkMin: e.totalWorkMin,
      jobCode: e.jobCode,
      approvalStatus: e.approvalStatus,
      employeeName: e.employee.name,
    }));
    pendingCount += entries.filter(
      (e) => e.date >= start && e.date <= end && e.approvalStatus === "PENDING",
    ).length;
    const notes = new Map(
      (
        await db.payrollPeriodNote.findMany({
          where: { periodStart: p.payPeriodStart, periodEnd: p.payPeriodEnd },
          select: { employeeId: true, note: true },
        })
      ).map((n) => [n.employeeId, n.note]),
    );
    sheets.push(buildPeriodSheet({ period: { start, end }, entries, salariedNames, notes }));
  }
  const first = periods[0]!;
  const last = periods[periods.length - 1]!;
  return {
    xlsx: buildWorkbookXlsx(sheets),
    filename: `payroll-${dateOnlyToString(first.payPeriodEnd)}${periods.length > 1 ? `-with-${periods.length - 1}-prior` : ""}.xlsx`,
    periods: periods.length,
    pendingCount,
    from: dateOnlyToString(last.payPeriodStart),
    to: dateOnlyToString(first.payPeriodEnd),
  };
}
