import { db } from "@/lib/db";
import {
  allocateWeeklyOvertime,
  csvRow,
  isoWeekEnd,
  isoWeekStart,
  type SlipEntry,
} from "@/lib/payroll-overtime";

export type PayrollSlipRow = {
  employeeId: string;        // EMP-YYYY-NNNN
  employeeRowId: string;
  name: string;
  email: string | null;
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

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Compute payroll slip rows for a given pay period.
 *
 * Rules:
 *  - Counts only APPROVED time entries with a clock-out.
 *  - Overtime = minutes over 40 in a Mon-Sun week. We load WHOLE weeks around
 *    the period, walk them chronologically, and attribute to this period only
 *    the minutes worked inside it (see lib/payroll-overtime) so a week that
 *    straddles two periods is never double counted.
 *  - TimeEntry.date is the business-calendar day (@db.Date), so day keys are
 *    read as UTC without any timezone shifting.
 */
export async function getPayrollSlipsForPeriod(
  payPeriodStart: Date,
  payPeriodEnd: Date,
): Promise<PayrollSlipRow[]> {
  const startKey = dayStr(payPeriodStart);
  const endKey = dayStr(payPeriodEnd);
  const fetchFrom = new Date(`${isoWeekStart(startKey)}T00:00:00.000Z`);
  const fetchTo = new Date(`${isoWeekEnd(endKey)}T00:00:00.000Z`);

  const entries = await db.timeEntry.findMany({
    where: {
      approvalStatus: "APPROVED",
      clockOut: { not: null },
      date: { gte: fetchFrom, lte: fetchTo },
    },
    select: {
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
    orderBy: [{ date: "asc" }, { clockIn: "asc" }],
  });

  type Bucket = {
    emp: (typeof entries)[number]["employee"];
    slip: SlipEntry[];
    daySet: Set<string>;
    firstClockIn: Date | null;
    lastClockOut: Date | null;
  };
  const buckets = new Map<string, Bucket>();

  for (const e of entries) {
    let b = buckets.get(e.employee.id);
    if (!b) {
      b = { emp: e.employee, slip: [], daySet: new Set(), firstClockIn: null, lastClockOut: null };
      buckets.set(e.employee.id, b);
    }
    const key = dayStr(e.date);
    b.slip.push({ date: key, clockIn: e.clockIn.getTime(), minutes: e.totalWorkMin });
    if (key >= startKey && key <= endKey) {
      if (e.totalWorkMin > 0) b.daySet.add(key);
      if (!b.firstClockIn || e.clockIn < b.firstClockIn) b.firstClockIn = e.clockIn;
      if (e.clockOut && (!b.lastClockOut || e.clockOut > b.lastClockOut)) b.lastClockOut = e.clockOut;
    }
  }

  const rows: PayrollSlipRow[] = [];
  for (const b of buckets.values()) {
    const alloc = allocateWeeklyOvertime(b.slip, startKey, endKey);
    if (alloc.weeks.length === 0) continue; // nothing worked inside this period
    rows.push({
      employeeRowId: b.emp.id,
      employeeId: b.emp.employeeId,
      name: b.emp.name,
      email: b.emp.email,
      profilePic: b.emp.profilePic,
      department: b.emp.department?.name ?? null,
      weeks: alloc.weeks.map((w) => ({
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        regular: round2(w.regularMin / 60),
        overtime: round2(w.overtimeMin / 60),
      })),
      regularHours: round2(alloc.regularMin / 60),
      overtimeHours: round2(alloc.overtimeMin / 60),
      totalHours: round2((alloc.regularMin + alloc.overtimeMin) / 60),
      daysWorked: b.daySet.size,
      firstClockIn: b.firstClockIn,
      lastClockOut: b.lastClockOut,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** CSV serialiser (RFC 4180, every field quoted, formula-injection safe). */
export function payrollSlipsToCsv(
  periodTitle: string,
  start: Date,
  end: Date,
  rows: PayrollSlipRow[],
): string {
  const header = csvRow([
    "Employee ID",
    "Name",
    "Department",
    "Pay Period Start",
    "Pay Period End",
    "Days Worked",
    "Regular Hours",
    "Overtime Hours",
    "Total Hours",
  ]);
  const lines = rows.map((r) =>
    csvRow([
      r.employeeId,
      r.name,
      r.department ?? "",
      dayStr(start),
      dayStr(end),
      r.daysWorked,
      r.regularHours,
      r.overtimeHours,
      r.totalHours,
    ]),
  );
  return [csvRow([periodTitle]), header, ...lines].join("\r\n");
}
