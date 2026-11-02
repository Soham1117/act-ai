import { db } from "@/lib/db";
import {
  addDaysDateOnly,
  dateOnlyToString,
  dateToBusinessLocal,
  parseDateOnly,
  startOfBusinessWeek,
} from "@/lib/time-rules";
import {
  reportContractHours,
  reportFallingHours,
  reportNewHireRamp,
  reportOvertimeByDepartment,
  reportPayrollSummary,
  reportStaffingForecast,
  reportWatchQuality,
  reportWeeklyDigest,
} from "@/lib/watch/rules-reports";
import { currentPeriod, DAY_MS, type RuleJob } from "../context";

const businessToday = (now: Date) => parseDateOnly(dateToBusinessLocal(now).slice(0, 10)) ?? new Date(0);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const REPORT_JOBS: RuleJob[] = [
  {
    id: "report.contract-hours",
    async run({ now }) {
      const thisWeek = startOfBusinessWeek(businessToday(now));
      const lastWeek = addDaysDateOnly(thisWeek, -7);
      const priorWeek = addDaysDateOnly(thisWeek, -14);
      const entries = await db.contractTimeEntry.findMany({
        where: { date: { gte: priorWeek, lt: thisWeek }, clockOut: { not: null } },
        select: { date: true, jobCode: true, totalWorkMin: true, contractWorker: { select: { agency: { select: { name: true } } } } },
      });
      const acc = new Map<string, { agency: string; jobCode: string; minutes: number; prevMinutes: number }>();
      for (const e of entries) {
        const k = `${e.contractWorker.agency.name}|${e.jobCode}`;
        const a = acc.get(k) ?? { agency: e.contractWorker.agency.name, jobCode: e.jobCode, minutes: 0, prevMinutes: 0 };
        if (e.date >= lastWeek) a.minutes += e.totalWorkMin;
        else a.prevMinutes += e.totalWorkMin;
        acc.set(k, a);
      }
      const rows = [...acc.values()].filter((r) => r.minutes > 0 || r.prevMinutes > 0);
      const emp = await db.timeEntry.groupBy({
        by: ["jobCode"],
        where: { date: { gte: lastWeek, lt: thisWeek }, clockOut: { not: null } },
        _sum: { totalWorkMin: true },
      });
      const byCode = new Map(emp.map((e) => [e.jobCode.toLowerCase(), e._sum.totalWorkMin ?? 0]));
      return reportContractHours(dateOnlyToString(lastWeek), rows, byCode);
    },
  },
  {
    id: "report.payroll-summary",
    async run({ now }) {
      const p = await currentPeriod();
      if (!p) return [];
      const today = businessToday(now);
      const daysTotal = Math.round((p.payPeriodEnd.getTime() - p.payPeriodStart.getTime()) / DAY_MS) + 1;
      const daysElapsed = Math.min(daysTotal, Math.max(0, Math.round((today.getTime() - p.payPeriodStart.getTime()) / DAY_MS)));
      const prevStart = new Date(p.payPeriodStart.getTime() - daysTotal * DAY_MS);
      const prevEnd = new Date(p.payPeriodStart.getTime() - DAY_MS);
      const sums = async (from: Date, to: Date) =>
        db.timeEntry.groupBy({ by: ["employeeId"], where: { date: { gte: from, lte: to }, clockOut: { not: null } }, _sum: { totalWorkMin: true } });
      const sameDaysEnd = new Date(prevStart.getTime() + Math.max(0, daysElapsed - 1) * DAY_MS);
      const [cur, prev, prevSame] = await Promise.all([sums(p.payPeriodStart, p.payPeriodEnd), sums(prevStart, prevEnd), sums(prevStart, sameDaysEnd)]);
      const minutes = cur.reduce((n, r) => n + (r._sum.totalWorkMin ?? 0), 0);
      const prevMinutes = prev.reduce((n, r) => n + (r._sum.totalWorkMin ?? 0), 0);
      const sameMap = new Map(prevSame.map((r) => [r.employeeId, r._sum.totalWorkMin ?? 0]));
      const gains = cur
        .map((r) => ({ id: r.employeeId, minutes: r._sum.totalWorkMin ?? 0, prevMinutes: sameMap.get(r.employeeId) ?? 0 }))
        .filter((g) => g.minutes - g.prevMinutes >= 8 * 60)
        .sort((a, b) => b.minutes - b.prevMinutes - (a.minutes - a.prevMinutes))
        .slice(0, 5);
      const names = new Map(
        (await db.employee.findMany({ where: { id: { in: gains.map((g) => g.id) } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]),
      );
      return reportPayrollSummary({
        periodId: p.id,
        title: p.title,
        minutes,
        headcount: cur.length,
        prevMinutes,
        daysElapsed,
        daysTotal,
        topIncreases: gains.map((g) => ({ name: names.get(g.id) ?? "Unknown", minutes: g.minutes, prevMinutes: g.prevMinutes })),
      });
    },
  },
  {
    id: "report.weekly-digest",
    async run({ now }) {
      const weekKey = dateOnlyToString(startOfBusinessWeek(businessToday(now)));
      const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
      const [raised, cleared, openNow, recent] = await Promise.all([
        db.watchFinding.count({ where: { firstSeenAt: { gte: weekAgo }, ruleId: { not: { startsWith: "report." } } } }),
        db.watchFinding.count({ where: { resolvedAt: { gte: weekAgo }, ruleId: { not: { startsWith: "report." } } } }),
        db.watchFinding.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, ruleId: { not: { startsWith: "report." } } } }),
        db.watchFinding.groupBy({
          by: ["employeeId"],
          where: { employeeId: { not: null }, firstSeenAt: { gte: new Date(now.getTime() - 28 * DAY_MS) }, severity: { not: "INFO" } },
          _count: { _all: true },
          having: { employeeId: { _count: { gte: 3 } } },
        }),
      ]);
      const names = new Map(
        (await db.employee.findMany({ where: { id: { in: recent.map((r) => r.employeeId!) } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]),
      );
      return reportWeeklyDigest({
        weekKey,
        raised,
        cleared,
        openNow,
        repeat: recent.map((r) => ({ name: names.get(r.employeeId!) ?? "Unknown", count: r._count._all })),
      });
    },
  },
  {
    id: "report.watch-quality",
    async run({ now }) {
      const weekKey = dateOnlyToString(startOfBusinessWeek(businessToday(now)));
      const rows = await db.watchFinding.groupBy({
        by: ["ruleId", "status"],
        where: { firstSeenAt: { gte: new Date(now.getTime() - 7 * DAY_MS) }, ruleId: { not: { startsWith: "report." } } },
        _count: { _all: true },
      });
      const stats = new Map<string, { ruleId: string; raised: number; acknowledged: number; dismissed: number; snoozed: number }>();
      for (const r of rows) {
        const s = stats.get(r.ruleId) ?? { ruleId: r.ruleId, raised: 0, acknowledged: 0, dismissed: 0, snoozed: 0 };
        s.raised += r._count._all;
        if (r.status === "ACKNOWLEDGED") s.acknowledged += r._count._all;
        if (r.status === "DISMISSED") s.dismissed += r._count._all;
        if (r.status === "SNOOZED") s.snoozed += r._count._all;
        stats.set(r.ruleId, s);
      }
      return reportWatchQuality(weekKey, [...stats.values()]);
    },
  },
  {
    id: "report.staffing-forecast",
    async run({ now }) {
      const today = businessToday(now);
      const end = addDaysDateOnly(today, 13);
      const [sched, leave] = await Promise.all([
        db.schedule.groupBy({ by: ["date"], where: { date: { gte: today, lte: end } }, _count: { _all: true } }),
        db.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: end }, endDate: { gte: today } }, select: { startDate: true, endDate: true } }),
      ]);
      const perDay = new Map(sched.map((s) => [dateOnlyToString(s.date), s._count._all]));
      const days = Array.from({ length: 14 }, (_, i) => {
        const d = addDaysDateOnly(today, i);
        return {
          date: dateOnlyToString(d),
          weekday: WEEKDAYS[d.getUTCDay()]!,
          scheduled: perDay.get(dateOnlyToString(d)) ?? 0,
          onLeave: leave.filter((l) => l.startDate <= d && l.endDate >= d).length,
        };
      });
      return reportStaffingForecast(dateOnlyToString(startOfBusinessWeek(today)), days);
    },
  },
  {
    id: "report.overtime-by-department",
    async run({ now, policy }) {
      const weekStart = startOfBusinessWeek(businessToday(now));
      const rows = await db.timeEntry.groupBy({
        by: ["employeeId"],
        where: { date: { gte: weekStart }, employee: { employmentStatus: "ACTIVE" } },
        _sum: { totalWorkMin: true },
      });
      const people = await db.employee.findMany({
        where: { id: { in: rows.map((r) => r.employeeId) } },
        select: { id: true, department: { select: { name: true } } },
      });
      const dept = new Map(people.map((p) => [p.id, p.department?.name ?? "No department"]));
      const acc = new Map<string, { department: string; minutes: number; overtimeMinutes: number; people: number }>();
      for (const r of rows) {
        const name = dept.get(r.employeeId) ?? "No department";
        const m = r._sum.totalWorkMin ?? 0;
        const a = acc.get(name) ?? { department: name, minutes: 0, overtimeMinutes: 0, people: 0 };
        a.minutes += m;
        a.overtimeMinutes += Math.max(0, m - policy.weeklyOvertimeHours * 60);
        a.people++;
        acc.set(name, a);
      }
      return reportOvertimeByDepartment(dateOnlyToString(weekStart), [...acc.values()]);
    },
  },
  {
    id: "report.new-hire-ramp",
    async run({ now }) {
      const today = businessToday(now);
      const people = await db.employee.findMany({
        where: { employmentStatus: "ACTIVE", dateOfHire: { gte: new Date(today.getTime() - 30 * DAY_MS) } },
        select: { id: true, name: true, dateOfHire: true },
      });
      if (people.length === 0) return [];
      const ids = people.map((p) => p.id);
      const [entries, items] = await Promise.all([
        db.timeEntry.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, date: true, totalWorkMin: true } }),
        db.onboardingChecklistItem.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, status: true } }),
      ]);
      return reportNewHireRamp(
        dateOnlyToString(startOfBusinessWeek(today)),
        people.map((p) => {
          const mine = entries.filter((e) => e.employeeId === p.id);
          const its = items.filter((i) => i.employeeId === p.id);
          return {
            name: p.name,
            hireDate: dateOnlyToString(p.dateOfHire!),
            minutes: mine.reduce((n, e) => n + e.totalWorkMin, 0),
            days: new Set(mine.map((e) => dateOnlyToString(e.date))).size,
            itemsDone: its.filter((i) => i.status === "ACCEPTED").length,
            itemsTotal: its.length,
          };
        }),
      );
    },
  },
  {
    id: "report.falling-hours",
    async run({ now }) {
      const thisWeek = startOfBusinessWeek(businessToday(now));
      const starts = [4, 3, 2, 1].map((n) => addDaysDateOnly(thisWeek, -7 * n));
      const rows = await db.timeEntry.findMany({
        where: { date: { gte: starts[0]!, lt: thisWeek }, clockOut: { not: null }, employee: { employmentStatus: "ACTIVE" } },
        select: { employeeId: true, date: true, totalWorkMin: true, employee: { select: { name: true } } },
      });
      const acc = new Map<string, { name: string; weeks: number[] }>();
      for (const r of rows) {
        const a = acc.get(r.employeeId) ?? { name: r.employee.name, weeks: [0, 0, 0, 0] };
        const idx = starts.findIndex((s, i) => r.date >= s && (i === 3 ? r.date < thisWeek : r.date < starts[i + 1]!));
        if (idx >= 0) a.weeks[idx] += r.totalWorkMin;
        acc.set(r.employeeId, a);
      }
      return reportFallingHours(dateOnlyToString(thisWeek), [...acc.values()]);
    },
  },
];
