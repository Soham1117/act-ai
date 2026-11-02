import { db } from "@/lib/db";
import { loadBalanceInputs } from "@/lib/leave-balance-db";
import { overdrawnYears } from "@/lib/leave-balance";
import {
  addDaysDateOnly,
  dateOnlyToString,
  dateToBusinessLocal,
  parseDateOnly,
  startOfBusinessWeek,
} from "@/lib/time-rules";
import { periodHasEnded } from "@/lib/watch/rules";
import {
  evaluateDuplicatePaystubs,
  evaluateEntrySanity,
  evaluateHoursTotalSpike,
  evaluateLeaveCoverage,
  evaluateLeaveOverdrawn,
  evaluateNewHireForms,
  evaluateOvertimeForecast,
  evaluatePeriodGaps,
  evaluateReimbursements,
  evaluateTerminatedWithHours,
  evaluateUnpaidReimbursements,
} from "@/lib/watch/rules-payroll";
import { currentPeriod, DAY_MS, type RuleJob } from "../context";

const MIN = 60_000;
const businessToday = (now: Date) => parseDateOnly(dateToBusinessLocal(now).slice(0, 10)) ?? new Date(0);

function scheduleMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let m = eh! * 60 + em! - (sh! * 60 + sm!);
  if (m < 0) m += 24 * 60;
  return m;
}

export const PAYROLL_JOBS: RuleJob[] = [
  {
    id: "payroll.hours-total-spike",
    async run({ now }) {
      const p = await currentPeriod();
      if (!p || !periodHasEnded(p.payPeriodEnd, now)) return [];
      const periods = await db.payrollCalendar.findMany({
        where: { payPeriodStart: { lt: p.payPeriodStart } },
        orderBy: { payPeriodStart: "desc" },
        take: 4,
      });
      const total = async (from: Date, to: Date) =>
        (
          await db.timeEntry.aggregate({
            where: { date: { gte: from, lte: to }, clockOut: { not: null } },
            _sum: { totalWorkMin: true },
          })
        )._sum.totalWorkMin ?? 0;
      const [cur, ...prev] = await Promise.all([
        total(p.payPeriodStart, p.payPeriodEnd),
        ...periods.map((x) => total(x.payPeriodStart, x.payPeriodEnd)),
      ]);
      return evaluateHoursTotalSpike(
        { periodId: p.id, title: p.title, minutes: cur ?? 0 },
        periods.map((x, i) => ({ periodId: x.id, title: x.title, minutes: prev[i] ?? 0 })),
      );
    },
  },
  {
    id: "payroll.entry-sanity",
    async run({ now }) {
      const since = new Date(businessToday(now).getTime() - 21 * DAY_MS);
      const rows = await db.timeEntry.findMany({
        where: { date: { gte: since }, clockOut: { not: null } },
        select: {
          id: true,
          employeeId: true,
          date: true,
          clockIn: true,
          clockOut: true,
          totalWorkMin: true,
          totalBreakMin: true,
          source: true,
          employee: { select: { name: true } },
        },
      });
      return evaluateEntrySanity(
        rows.map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          name: r.employee.name,
          date: dateOnlyToString(r.date),
          clockIn: r.clockIn,
          clockOut: r.clockOut!,
          workMin: r.totalWorkMin,
          breakMin: r.totalBreakMin,
          source: r.source,
        })),
      );
    },
  },
  {
    id: "payroll.duplicate-paystub",
    async run({ now }) {
      const rows = await db.payroll.findMany({
        where: { payPeriodEnd: { gte: new Date(now.getTime() - 120 * DAY_MS) } },
        select: {
          id: true,
          employeeId: true,
          category: true,
          payPeriodStart: true,
          payPeriodEnd: true,
          fileSha256: true,
          employee: { select: { name: true } },
        },
      });
      return evaluateDuplicatePaystubs(
        rows.map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          name: r.employee.name,
          category: r.category,
          start: dateOnlyToString(r.payPeriodStart),
          end: dateOnlyToString(r.payPeriodEnd),
          sha: r.fileSha256,
        })),
      );
    },
  },
  {
    id: "payroll.terminated-with-hours",
    async run({ now }) {
      const since = new Date(businessToday(now).getTime() - 45 * DAY_MS);
      const people = await db.employee.findMany({
        where: { employmentStatus: "TERMINATED", terminationDate: { not: null } },
        select: { id: true, name: true, terminationDate: true },
      });
      if (people.length === 0) return [];
      const entries = await db.timeEntry.findMany({
        where: { employeeId: { in: people.map((p) => p.id) }, date: { gte: since } },
        select: { employeeId: true, date: true },
      });
      return evaluateTerminatedWithHours(
        people.flatMap((p) => {
          const after = entries.filter(
            (e) => e.employeeId === p.id && e.date.getTime() > p.terminationDate!.getTime(),
          );
          if (after.length === 0) return [];
          const last = after.reduce((m, e) => (e.date > m ? e.date : m), after[0]!.date);
          return [
            {
              employeeId: p.id,
              name: p.name,
              terminationDate: dateOnlyToString(p.terminationDate!),
              lastEntryDate: dateOnlyToString(last),
              entries: after.length,
            },
          ];
        }),
      );
    },
  },
  {
    id: "payroll.new-hire-forms",
    async run({ now }) {
      const today = businessToday(now);
      const people = await db.employee.findMany({
        where: {
          employmentStatus: "ACTIVE",
          dateOfHire: { gte: new Date(today.getTime() - 60 * DAY_MS) },
          timeEntries: { some: { date: { gte: new Date(today.getTime() - 14 * DAY_MS) } } },
        },
        select: { id: true, name: true, dateOfHire: true },
      });
      if (people.length === 0) return [];
      const items = await db.onboardingChecklistItem.findMany({
        where: { employeeId: { in: people.map((p) => p.id) } },
        select: { employeeId: true, title: true, status: true },
      });
      return evaluateNewHireForms(
        people.map((p) => ({
          employeeId: p.id,
          name: p.name,
          hireDate: dateOnlyToString(p.dateOfHire!),
          missing: items
            .filter(
              (i) =>
                i.employeeId === p.id &&
                /\bW-?4\b|\bI-?9\b/i.test(i.title) &&
                i.status !== "ACCEPTED" &&
                i.status !== "NOT_APPLICABLE",
            )
            .map((i) => (/I-?9/i.test(i.title) ? "I-9" : "W-4")),
        })),
      );
    },
  },
  {
    id: "payroll.reimbursement-unpaid",
    async run({ now }) {
      const rows = await db.reimbursement.findMany({
        where: { status: "APPROVED", paidDate: null, approvalDate: { not: null } },
        select: {
          id: true,
          employeeId: true,
          title: true,
          approvalDate: true,
          employee: { select: { name: true } },
        },
      });
      return evaluateUnpaidReimbursements(
        rows.map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          name: r.employee.name,
          title: r.title,
          approvedDays: Math.floor((now.getTime() - r.approvalDate!.getTime()) / DAY_MS),
        })),
      );
    },
  },
  {
    id: "payroll.period-gap",
    async run() {
      const rows = await db.payrollCalendar.findMany({ orderBy: { payPeriodStart: "desc" }, take: 10 });
      return evaluatePeriodGaps(
        rows.map((r) => ({ id: r.id, title: r.title, start: r.payPeriodStart, end: r.payPeriodEnd })),
      );
    },
  },
  {
    id: "payroll.overtime-forecast",
    async run({ now, policy }) {
      const p = await currentPeriod();
      if (!p) return [];
      const today = businessToday(now);
      const first = startOfBusinessWeek(p.payPeriodStart);
      const last = addDaysDateOnly(startOfBusinessWeek(p.payPeriodEnd), 6);
      const [entries, future] = await Promise.all([
        db.timeEntry.findMany({
          where: { date: { gte: first, lte: last }, employee: { employmentStatus: "ACTIVE" } },
          select: {
            employeeId: true,
            date: true,
            clockIn: true,
            clockOut: true,
            totalWorkMin: true,
            employee: { select: { name: true } },
          },
        }),
        db.schedule.findMany({
          where: { date: { gt: today, lte: last }, employee: { employmentStatus: "ACTIVE" } },
          select: {
            employeeId: true,
            date: true,
            startTime: true,
            endTime: true,
            employee: { select: { name: true } },
          },
        }),
      ]);
      const acc = new Map<string, { name: string; weekStart: string; minutes: number; employeeId: string }>();
      const add = (employeeId: string, name: string, date: Date, minutes: number) => {
        const weekStart = dateOnlyToString(startOfBusinessWeek(date));
        const k = `${employeeId}:${weekStart}`;
        const a = acc.get(k) ?? { employeeId, name, weekStart, minutes: 0 };
        a.minutes += minutes;
        acc.set(k, a);
      };
      for (const e of entries) {
        const minutes = e.clockOut
          ? e.totalWorkMin
          : Math.max(0, Math.floor((now.getTime() - e.clockIn.getTime()) / MIN));
        add(e.employeeId, e.employee.name, e.date, minutes);
      }
      for (const f of future) add(f.employeeId, f.employee.name, f.date, scheduleMinutes(f.startTime, f.endTime));
      return evaluateOvertimeForecast(p.id, p.title, [...acc.values()], policy.weeklyOvertimeHours);
    },
  },
  {
    id: "leave.coverage",
    async run({ now, policy }) {
      const today = businessToday(now);
      const pending = await db.leaveRequest.findMany({
        where: { status: "PENDING", endDate: { gte: today }, employee: { departmentId: { not: null } } },
        select: {
          id: true,
          employeeId: true,
          startDate: true,
          endDate: true,
          employee: { select: { name: true, departmentId: true, department: { select: { name: true } } } },
        },
      });
      if (pending.length === 0) return [];
      const deptIds = [...new Set(pending.map((r) => r.employee.departmentId!))];
      const [heads, overlapping] = await Promise.all([
        db.employee.groupBy({
          by: ["departmentId"],
          where: { departmentId: { in: deptIds }, employmentStatus: "ACTIVE" },
          _count: { _all: true },
        }),
        db.leaveRequest.findMany({
          where: {
            status: { in: ["PENDING", "APPROVED"] },
            endDate: { gte: today },
            employee: { departmentId: { in: deptIds } },
          },
          select: { id: true, startDate: true, endDate: true, employee: { select: { departmentId: true } } },
        }),
      ]);
      const headcount = new Map(heads.map((h) => [h.departmentId, h._count._all]));
      return evaluateLeaveCoverage(
        pending.map((r) => ({
          requestId: r.id,
          employeeId: r.employeeId,
          name: r.employee.name,
          department: r.employee.department?.name ?? "the department",
          start: r.startDate,
          end: r.endDate,
          headcount: headcount.get(r.employee.departmentId) ?? 0,
          others: overlapping
            .filter(
              (o) =>
                o.id !== r.id &&
                o.employee.departmentId === r.employee.departmentId &&
                o.startDate <= r.endDate &&
                o.endDate >= r.startDate,
            )
            .map((o) => ({ start: o.startDate, end: o.endDate })),
        })),
        policy.leaveMaxShare,
      );
    },
  },
  {
    id: "leave.overdrawn",
    async run({ now }) {
      const today = businessToday(now);
      const reqs = await db.leaveRequest.findMany({
        where: { status: { in: ["PENDING", "APPROVED"] }, endDate: { gte: today } },
        select: {
          id: true,
          employeeId: true,
          leaveType: true,
          startDate: true,
          endDate: true,
          startHalfDay: true,
          endHalfDay: true,
          employee: { select: { name: true } },
        },
      });
      if (reqs.length === 0) return [];
      const ids = [...new Set(reqs.map((r) => r.employeeId))];
      const years = [...new Set(reqs.flatMap((r) => [r.startDate.getUTCFullYear(), r.endDate.getUTCFullYear()]))];
      const inputs = await loadBalanceInputs(ids, years);
      return evaluateLeaveOverdrawn(
        reqs.map((r) => {
          const input = inputs.get(r.employeeId);
          return {
            requestId: r.id,
            employeeId: r.employeeId,
            name: r.employee.name,
            leaveType: r.leaveType,
            years: input ? overdrawnYears(input, r.leaveType, r) : [],
          };
        }),
      );
    },
  },
  {
    id: "reimbursement.issues",
    async run({ now }) {
      const rows = await db.reimbursement.findMany({
        where: { createdAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          employeeId: true,
          title: true,
          amount: true,
          expenseDate: true,
          status: true,
          employee: { select: { name: true } },
          _count: { select: { receipts: true } },
        },
      });
      return evaluateReimbursements(
        rows.map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          name: r.employee.name,
          title: r.title,
          amount: r.amount.toString(),
          expenseDate: dateOnlyToString(r.expenseDate),
          status: r.status,
          receipts: r._count.receipts,
        })),
      );
    },
  },
];
