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

export type PayrollReadinessException =
  | "ZERO_HOURS"
  | "OPEN"
  | "PENDING"
  | "REJECTED"
  | "AUTO_CLOSED";

export type PayrollReadinessEmployee = {
  employeeRowId: string;
  employeeId: string;
  name: string;
  department: string | null;
  approvedMinutes: number;
  exceptions: PayrollReadinessException[];
};

export type PayrollReadiness = {
  employees: PayrollReadinessEmployee[];
  blocking: boolean;
  summary: Record<PayrollReadinessException, number>;
};

type ReadinessEmployeeInput = {
  id: string;
  employeeId: string;
  name: string;
  department: { name: string } | null;
};

type ReadinessEntryInput = {
  employeeId: string;
  clockOut: Date | null;
  status: string;
  approvalStatus: string;
  autoClosed: boolean;
  totalWorkMin: number;
};

/** Pure readiness projection used by the page, export gate, and focused tests. */
export function buildPayrollReadiness(
  employees: ReadinessEmployeeInput[],
  entries: ReadinessEntryInput[],
): PayrollReadiness {
  const rows = employees.map((employee) => {
    const own = entries.filter((entry) => entry.employeeId === employee.id);
    const approvedMinutes = own
      .filter((entry) => entry.approvalStatus === "APPROVED" && entry.clockOut)
      .reduce((sum, entry) => sum + entry.totalWorkMin, 0);
    const exceptions: PayrollReadinessException[] = [];
    if (approvedMinutes <= 0) exceptions.push("ZERO_HOURS");
    if (own.some((entry) => !entry.clockOut || entry.status === "ACTIVE" || entry.status === "ON_BREAK")) {
      exceptions.push("OPEN");
    }
    if (own.some((entry) => entry.approvalStatus === "PENDING")) exceptions.push("PENDING");
    if (own.some((entry) => entry.approvalStatus === "REJECTED")) exceptions.push("REJECTED");
    if (own.some((entry) => entry.autoClosed)) exceptions.push("AUTO_CLOSED");
    return {
      employeeRowId: employee.id,
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department?.name ?? null,
      approvedMinutes,
      exceptions,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const summary: PayrollReadiness["summary"] = {
    ZERO_HOURS: 0,
    OPEN: 0,
    PENDING: 0,
    REJECTED: 0,
    AUTO_CLOSED: 0,
  };
  for (const row of rows) for (const exception of row.exceptions) summary[exception]++;
  return { employees: rows, blocking: rows.some((row) => row.exceptions.length > 0), summary };
}

export async function getPayrollReadinessForPeriod(
  payPeriodStart: Date,
  payPeriodEnd: Date,
  client: Pick<typeof db, "employee" | "timeEntry"> = db,
): Promise<PayrollReadiness> {
  const [employees, entries] = await Promise.all([
    client.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: { select: { name: true } },
      },
    }),
    client.timeEntry.findMany({
      where: { date: { gte: payPeriodStart, lte: payPeriodEnd } },
      select: {
        employeeId: true,
        clockOut: true,
        status: true,
        approvalStatus: true,
        autoClosed: true,
        totalWorkMin: true,
      },
    }),
  ]);
  return buildPayrollReadiness(employees, entries);
}

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
  client: Pick<typeof db, "timeEntry"> = db,
): Promise<PayrollSlipRow[]> {
  const startKey = dayStr(payPeriodStart);
  const endKey = dayStr(payPeriodEnd);
  const fetchFrom = new Date(`${isoWeekStart(startKey)}T00:00:00.000Z`);
  const fetchTo = new Date(`${isoWeekEnd(endKey)}T00:00:00.000Z`);

  const entries = await client.timeEntry.findMany({
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
