import { db } from "@/lib/db";
import { eachWeekOfInterval, endOfWeek, isWithinInterval, startOfWeek } from "date-fns";

export type PayrollSlipRow = {
  employeeId: string;        // EMP-YYYY-NNNN
  employeeRowId: string;
  name: string;
  email: string;
  profilePic: string | null;
  department: string | null;
  weeks: Array<{ weekStart: string; weekEnd: string; regular: number; overtime: number }>;
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
  daysWorked: number;
  firstClockIn: Date | null;
  lastClockOut: Date | null;
};

/**
 * Compute payroll slip rows for a given pay period.
 *
 * Rules:
 *  - Counts only APPROVED time entries with a clock-out.
 *  - Hours = TimeEntry.totalWorkMin / 60, summed per ISO week.
 *  - Overtime = hours over 40 in any ISO week (US standard).
 *  - Overlap of a week with the pay period is full-week (we report
 *    regular + overtime as computed against the whole ISO week).
 */
export async function getPayrollSlipsForPeriod(
  payPeriodStart: Date,
  payPeriodEnd: Date,
): Promise<PayrollSlipRow[]> {
  const entries = await db.timeEntry.findMany({
    where: {
      approvalStatus: "APPROVED",
      clockOut: { not: null },
      date: { gte: payPeriodStart, lte: payPeriodEnd },
    },
    select: {
      employeeId: true,
      date: true,
      clockIn: true,
      clockOut: true,
      totalWorkMin: true,
      employee: {
        select: {
          id: true,
          employeeId: true,
          name: true,
          email: true,
          profilePic: true,
          department: { select: { name: true } },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  // Group entries by employee.
  type Bucket = {
    employee: PayrollSlipRow;
    weekly: Map<string, number>; // ISO-week-start string → total minutes
    daySet: Set<string>;
    firstClockIn: Date | null;
    lastClockOut: Date | null;
  };
  const buckets = new Map<string, Bucket>();

  for (const e of entries) {
    let b = buckets.get(e.employee.id);
    if (!b) {
      b = {
        employee: {
          employeeRowId: e.employee.id,
          employeeId: e.employee.employeeId,
          name: e.employee.name,
          email: e.employee.email,
          profilePic: e.employee.profilePic,
          department: e.employee.department?.name ?? null,
          weeks: [],
          regularHours: 0,
          overtimeHours: 0,
          totalHours: 0,
          daysWorked: 0,
          firstClockIn: null,
          lastClockOut: null,
        },
        weekly: new Map(),
        daySet: new Set(),
        firstClockIn: null,
        lastClockOut: null,
      };
      buckets.set(e.employee.id, b);
    }
    const wkKey = startOfWeek(e.date, { weekStartsOn: 1 }).toISOString();
    b.weekly.set(wkKey, (b.weekly.get(wkKey) ?? 0) + e.totalWorkMin);
    b.daySet.add(e.date.toISOString().slice(0, 10));
    if (e.clockIn && (!b.firstClockIn || e.clockIn < b.firstClockIn)) b.firstClockIn = e.clockIn;
    if (e.clockOut && (!b.lastClockOut || e.clockOut > b.lastClockOut)) b.lastClockOut = e.clockOut;
  }

  // Compute regular + overtime per week.
  const allWeeks = eachWeekOfInterval(
    { start: payPeriodStart, end: payPeriodEnd },
    { weekStartsOn: 1 },
  );

  const rows: PayrollSlipRow[] = [];
  for (const b of buckets.values()) {
    let regularTotal = 0;
    let overtimeTotal = 0;
    const weekRows: PayrollSlipRow["weeks"] = [];

    for (const wk of allWeeks) {
      const key = wk.toISOString();
      const minutes = b.weekly.get(key) ?? 0;
      const hours = minutes / 60;
      // Only count weeks that overlap the pay period.
      const wkEnd = endOfWeek(wk, { weekStartsOn: 1 });
      const overlaps =
        isWithinInterval(wk, { start: payPeriodStart, end: payPeriodEnd }) ||
        isWithinInterval(wkEnd, { start: payPeriodStart, end: payPeriodEnd }) ||
        (wk <= payPeriodStart && wkEnd >= payPeriodEnd);
      if (!overlaps) continue;
      const regular = Math.min(hours, 40);
      const overtime = Math.max(0, hours - 40);
      weekRows.push({
        weekStart: wk.toISOString().slice(0, 10),
        weekEnd: wkEnd.toISOString().slice(0, 10),
        regular: round2(regular),
        overtime: round2(overtime),
      });
      regularTotal += regular;
      overtimeTotal += overtime;
    }

    b.employee.weeks = weekRows;
    b.employee.regularHours = round2(regularTotal);
    b.employee.overtimeHours = round2(overtimeTotal);
    b.employee.totalHours = round2(regularTotal + overtimeTotal);
    b.employee.daysWorked = b.daySet.size;
    b.employee.firstClockIn = b.firstClockIn;
    b.employee.lastClockOut = b.lastClockOut;
    rows.push(b.employee);
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** CSV serialiser — used by the download button. */
export function payrollSlipsToCsv(
  periodTitle: string,
  start: Date,
  end: Date,
  rows: PayrollSlipRow[],
): string {
  const header = [
    "Employee ID",
    "Name",
    "Department",
    "Pay Period Start",
    "Pay Period End",
    "Days Worked",
    "Regular Hours",
    "Overtime Hours",
    "Total Hours",
  ].join(",");
  const lines = rows.map((r) =>
    [
      r.employeeId,
      `"${r.name.replace(/"/g, '""')}"`,
      r.department ?? "",
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
      r.daysWorked,
      r.regularHours,
      r.overtimeHours,
      r.totalHours,
    ].join(","),
  );
  return [`# ${periodTitle}`, header, ...lines].join("\n");
}
