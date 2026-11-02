import { db } from "@/lib/db";
import { businessLocalToDate, dateOnlyToString, dateToBusinessLocal, parseDateOnly } from "@/lib/time-rules";
import {
  evaluateCloseBlockers,
  evaluateDuplicateEmployees,
  evaluateHoursVariance,
  evaluateMissingClockOut,
  periodHasEnded,
  type PeriodHours,
} from "@/lib/watch/rules";
import { currentPeriod, DAY_MS, type RuleJob } from "../context";

export const CORE_JOBS: RuleJob[] = [
  {
    id: "time.missing-clock-out",
    async run({ now, policy }) {
      const open = await db.timeEntry.findMany({
        where: { clockOut: null, status: { in: ["ACTIVE", "ON_BREAK"] } },
        select: {
          id: true,
          employeeId: true,
          clockIn: true,
          date: true,
          employee: { select: { name: true } },
        },
      });
      if (open.length === 0) return [];
      const schedules = await db.schedule.findMany({
        where: {
          OR: open.map((e) => ({ employeeId: e.employeeId, date: e.date })),
        },
        select: { employeeId: true, date: true, endTime: true },
      });
      const period = await currentPeriod();
      const closesSoon = period ? period.payPeriodEnd.getTime() - now.getTime() <= 2 * DAY_MS : false;
      const punches = open.map((e) => {
        const s = schedules.find(
          (x) => x.employeeId === e.employeeId && x.date.getTime() === e.date.getTime(),
        );
        const scheduledEnd = s ? businessLocalToDate(`${dateOnlyToString(e.date)}T${s.endTime}`) : null;
        return {
          entryId: e.id,
          employeeId: e.employeeId,
          employeeName: e.employee.name,
          clockIn: e.clockIn,
          scheduledEnd,
        };
      });
      return evaluateMissingClockOut(punches, policy, now, closesSoon);
    },
  },
  {
    id: "payroll.close-blockers",
    async run({ now }) {
      const p = await currentPeriod();
      if (!p) return [];
      const range = { gte: p.payPeriodStart, lte: p.payPeriodEnd };
      // Today's shifts are still running; only earlier open punches block closing.
      const today = parseDateOnly(dateToBusinessLocal(now).slice(0, 10)) ?? new Date(0);
      const [pendingApprovals, openPunches] = await Promise.all([
        db.timeEntry.count({
          where: { date: range, approvalStatus: "PENDING", clockOut: { not: null } },
        }),
        db.timeEntry.count({ where: { date: { gte: p.payPeriodStart, lt: today <= p.payPeriodEnd ? today : new Date(p.payPeriodEnd.getTime() + 86_400_000) }, clockOut: null } }),
      ]);
      return evaluateCloseBlockers(
        {
          periodId: p.id,
          title: p.title,
          periodEnd: p.payPeriodEnd,
          closedAt: p.closedAt,
          pendingApprovals,
          openPunches,
        },
        now,
      );
    },
  },
  {
    id: "payroll.hours-variance",
    async run({ now, policy }) {
      const p = await currentPeriod();
      // A period still in progress always looks "down" against a full one, so wait until it ends.
      if (!p || !periodHasEnded(p.payPeriodEnd, now)) return [];
      const lengthMs = p.payPeriodEnd.getTime() - p.payPeriodStart.getTime() + DAY_MS;
      const prevStart = new Date(p.payPeriodStart.getTime() - lengthMs);
      const prevEnd = new Date(p.payPeriodStart.getTime() - DAY_MS);
      const sums = async (from: Date, to: Date) => {
        const rows = await db.timeEntry.groupBy({
          by: ["employeeId"],
          where: { date: { gte: from, lte: to }, clockOut: { not: null } },
          _sum: { totalWorkMin: true },
        });
        return new Map(rows.map((r) => [r.employeeId, r._sum.totalWorkMin ?? 0]));
      };
      const [cur, prev] = await Promise.all([
        sums(p.payPeriodStart, p.payPeriodEnd),
        sums(prevStart, prevEnd),
      ]);
      const names = await db.employee.findMany({
        where: { id: { in: [...prev.keys()] }, employmentStatus: "ACTIVE" },
        select: { id: true, name: true },
      });
      const rows: PeriodHours[] = names.map((n) => ({
        employeeId: n.id,
        employeeName: n.name,
        periodId: p.id,
        currentMinutes: cur.get(n.id) ?? 0,
        previousMinutes: prev.get(n.id) ?? 0,
      }));
      return evaluateHoursVariance(rows, policy);
    },
  },
  {
    id: "data.duplicate-employee",
    async run() {
      const people = await db.employee.findMany({
        where: { employmentStatus: "ACTIVE" },
        select: { id: true, name: true },
      });
      return evaluateDuplicateEmployees(people);
    },
  },
];
