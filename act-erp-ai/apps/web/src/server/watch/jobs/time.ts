import { db } from "@/lib/db";
import {
  addDaysDateOnly,
  businessLocalToDate,
  dateOnlyToString,
  dateToBusinessLocal,
  parseDateOnly,
  startOfBusinessWeek,
} from "@/lib/time-rules";
import { evaluateMissingClockOut } from "@/lib/watch/rules";
import {
  evaluateContractEntries,
  evaluateContractTenure,
  evaluateDuplicatePunches,
  evaluateEarlyArrival,
  evaluateHolidayWork,
  evaluateImpossibleShifts,
  evaluateLunch,
  evaluateMissingClockIn,
  evaluateNewKiosk,
  evaluateOvertimePace,
  evaluatePhotoMissing,
  evaluateRoundingDrift,
  evaluateScheduleVariance,
  type PunchRow,
} from "@/lib/watch/rules-time";
import { currentPeriod, DAY_MS, type RuleJob } from "../context";

const MIN = 60_000;

function businessToday(now: Date): Date {
  return parseDateOnly(dateToBusinessLocal(now).slice(0, 10)) ?? new Date(0);
}

const weekOf = (date: string) => {
  const d = parseDateOnly(date);
  return d ? dateOnlyToString(startOfBusinessWeek(d)) : date;
};

function scheduleMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let m = eh! * 60 + em! - (sh! * 60 + sm!);
  if (m < 0) m += 24 * 60;
  return m;
}

async function recentPunches(since: Date, extra: object = {}): Promise<PunchRow[]> {
  const rows = await db.timeEntry.findMany({
    where: { date: { gte: since }, employee: { employmentStatus: "ACTIVE" }, ...extra },
    select: {
      id: true,
      employeeId: true,
      date: true,
      clockIn: true,
      clockOut: true,
      totalWorkMin: true,
      totalBreakMin: true,
      source: true,
      kioskSlug: true,
      clockInPhotoKey: true,
      clockOutPhotoKey: true,
      actualClockIn: true,
      actualClockOut: true,
      timesheetNotes: true,
      employee: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    name: r.employee.name,
    date: dateOnlyToString(r.date),
    clockIn: r.clockIn,
    clockOut: r.clockOut,
    workMin: r.totalWorkMin,
    breakMin: r.totalBreakMin,
    source: r.source,
    kioskSlug: r.kioskSlug,
    hasPhotoIn: !!r.clockInPhotoKey,
    hasPhotoOut: !!r.clockOutPhotoKey,
    actualIn: r.actualClockIn,
    actualOut: r.actualClockOut,
    notes: r.timesheetNotes,
  }));
}

export const TIME_JOBS: RuleJob[] = [
  {
    // Off for now: schedules only start Nov 2 and most scheduled people still clock at the old TCP clock
    // (55 scheduled, 11 punched on day one). Turn on once everyone punches in Persona.
    id: "time.missing-clock-in",
    defaultEnabled: false,
    async run({ now }) {
      const today = businessToday(now);
      const shifts = await db.schedule.findMany({
        where: { date: today, employee: { employmentStatus: "ACTIVE" } },
        select: { id: true, employeeId: true, startTime: true, employee: { select: { name: true } } },
      });
      if (shifts.length === 0) return [];
      const ids = shifts.map((s) => s.employeeId);
      const [entries, leave] = await Promise.all([
        db.timeEntry.findMany({ where: { date: today, employeeId: { in: ids } }, select: { employeeId: true } }),
        db.leaveRequest.findMany({
          where: { employeeId: { in: ids }, status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } },
          select: { employeeId: true },
        }),
      ]);
      const worked = new Set(entries.map((e) => e.employeeId));
      const away = new Set(leave.map((l) => l.employeeId));
      const rows = shifts.flatMap((s) => {
        const start = businessLocalToDate(`${dateOnlyToString(today)}T${s.startTime}`);
        if (!start) return [];
        return [{ scheduleId: s.id, employeeId: s.employeeId, name: s.employee.name, start, hasEntry: worked.has(s.employeeId), onLeave: away.has(s.employeeId) }];
      });
      return evaluateMissingClockIn(rows, now);
    },
  },
  {
    id: "time.overtime-pace",
    async run({ now, policy }) {
      const today = businessToday(now);
      const weekStart = startOfBusinessWeek(today);
      const weekEnd = addDaysDateOnly(weekStart, 6);
      const [entries, future] = await Promise.all([
        db.timeEntry.findMany({
          where: { date: { gte: weekStart, lte: weekEnd }, employee: { employmentStatus: "ACTIVE" } },
          select: { employeeId: true, clockIn: true, clockOut: true, totalWorkMin: true, employee: { select: { name: true } } },
        }),
        db.schedule.findMany({
          where: { date: { gt: today, lte: weekEnd }, employee: { employmentStatus: "ACTIVE" } },
          select: { employeeId: true, startTime: true, endTime: true },
        }),
      ]);
      const people = new Map<string, { name: string; worked: number; remaining: number }>();
      for (const e of entries) {
        const p = people.get(e.employeeId) ?? { name: e.employee.name, worked: 0, remaining: 0 };
        p.worked += e.clockOut ? e.totalWorkMin : Math.max(0, Math.floor((now.getTime() - e.clockIn.getTime()) / MIN));
        people.set(e.employeeId, p);
      }
      for (const f of future) {
        const p = people.get(f.employeeId);
        if (p) p.remaining += scheduleMinutes(f.startTime, f.endTime);
      }
      const rows = [...people.entries()].map(([employeeId, p]) => ({
        employeeId,
        name: p.name,
        weekStart: dateOnlyToString(weekStart),
        workedMin: p.worked,
        scheduledRemainingMin: p.remaining,
      }));
      return evaluateOvertimePace(rows, policy);
    },
  },
  {
    // Kiosks do not log lunch yet (1 of 125 recent kiosk shifts has a break), so this would flag most shifts.
    id: "time.lunch",
    defaultEnabled: false,
    async run({ now, policy }) {
      const since = new Date(businessToday(now).getTime() - 3 * DAY_MS);
      return evaluateLunch(await recentPunches(since, { clockOut: { not: null } }), policy);
    },
  },
  {
    id: "time.impossible-shift",
    async run({ now, policy }) {
      const since = new Date(businessToday(now).getTime() - 14 * DAY_MS);
      return evaluateImpossibleShifts(await recentPunches(since), policy);
    },
  },
  {
    id: "time.duplicate-punch",
    async run({ now }) {
      const since = new Date(businessToday(now).getTime() - 7 * DAY_MS);
      return evaluateDuplicatePunches(await recentPunches(since));
    },
  },
  {
    id: "time.new-kiosk",
    async run({ now, policy }) {
      const today = businessToday(now);
      const recent = (await recentPunches(new Date(today.getTime() - 7 * DAY_MS))).filter((p) => p.kioskSlug);
      if (recent.length === 0) return [];
      const ids = [...new Set(recent.map((p) => p.employeeId))];
      const past = await db.timeEntry.findMany({
        where: { employeeId: { in: ids }, date: { gte: new Date(today.getTime() - 67 * DAY_MS), lt: new Date(today.getTime() - 7 * DAY_MS) } },
        select: { employeeId: true, kioskSlug: true },
      });
      const history = new Map<string, { count: number; kiosks: Set<string> }>();
      for (const r of past) {
        const h = history.get(r.employeeId) ?? { count: 0, kiosks: new Set<string>() };
        h.count++;
        if (r.kioskSlug) h.kiosks.add(r.kioskSlug);
        history.set(r.employeeId, h);
      }
      return evaluateNewKiosk(recent, history, policy);
    },
  },
  {
    id: "time.photo-missing",
    async run({ now }) {
      const since = new Date(businessToday(now).getTime() - 7 * DAY_MS);
      return evaluatePhotoMissing(await recentPunches(since, { source: "KIOSK" }), weekOf(dateOnlyToString(businessToday(now))));
    },
  },
  {
    id: "time.early-arrival-pattern",
    async run({ now, policy }) {
      const since = new Date(businessToday(now).getTime() - 14 * DAY_MS);
      const punches = await recentPunches(since);
      if (punches.length === 0) return [];
      const sched = await db.schedule.findMany({
        where: { date: { gte: since }, employeeId: { in: [...new Set(punches.map((p) => p.employeeId))] } },
        select: { employeeId: true, date: true, startTime: true },
      });
      const key = (id: string, d: string) => `${id}:${d}`;
      const starts = new Map(sched.map((s) => [key(s.employeeId, dateOnlyToString(s.date)), s.startTime]));
      const rows = punches.flatMap((p) => {
        const t = starts.get(key(p.employeeId, p.date));
        const start = t ? businessLocalToDate(`${p.date}T${t}`) : null;
        return start ? [{ employeeId: p.employeeId, name: p.name, date: p.date, minutesEarly: (start.getTime() - p.clockIn.getTime()) / MIN }] : [];
      });
      return evaluateEarlyArrival(rows, policy, dateOnlyToString(startOfBusinessWeek(businessToday(now))));
    },
  },
  {
    id: "time.rounding-drift",
    async run({ now }) {
      const since = new Date(businessToday(now).getTime() - 60 * DAY_MS);
      return evaluateRoundingDrift(await recentPunches(since, { clockOut: { not: null }, actualClockIn: { not: null }, actualClockOut: { not: null } }));
    },
  },
  {
    id: "time.holiday-work",
    async run({ now }) {
      const since = new Date(businessToday(now).getTime() - 14 * DAY_MS);
      return evaluateHolidayWork(await recentPunches(since, { clockOut: { not: null } }));
    },
  },
  {
    id: "time.schedule-variance",
    async run({ now, policy }) {
      const thisWeek = startOfBusinessWeek(businessToday(now));
      const lastWeek = addDaysDateOnly(thisWeek, -7);
      const lastEnd = addDaysDateOnly(thisWeek, -1);
      const [sched, worked] = await Promise.all([
        db.schedule.findMany({
          where: { date: { gte: lastWeek, lte: lastEnd }, employee: { employmentStatus: "ACTIVE" } },
          select: { employeeId: true, startTime: true, endTime: true, employee: { select: { name: true } } },
        }),
        db.timeEntry.groupBy({ by: ["employeeId"], where: { date: { gte: lastWeek, lte: lastEnd }, clockOut: { not: null } }, _sum: { totalWorkMin: true } }),
      ]);
      const done = new Map(worked.map((w) => [w.employeeId, w._sum.totalWorkMin ?? 0]));
      const plan = new Map<string, { name: string; min: number }>();
      for (const s of sched) {
        const p = plan.get(s.employeeId) ?? { name: s.employee.name, min: 0 };
        p.min += scheduleMinutes(s.startTime, s.endTime);
        plan.set(s.employeeId, p);
      }
      const rows = [...plan.entries()].map(([employeeId, p]) => ({
        employeeId,
        name: p.name,
        weekStart: dateOnlyToString(lastWeek),
        scheduledMin: p.min,
        workedMin: done.get(employeeId) ?? 0,
      }));
      return evaluateScheduleVariance(rows, policy);
    },
  },
];

export const CONTRACT_JOBS: RuleJob[] = [
  {
    id: "contract.missing-clock-out",
    async run({ now, policy }) {
      const open = await db.contractTimeEntry.findMany({
        where: { clockOut: null, status: { in: ["ACTIVE", "ON_BREAK"] } },
        select: { id: true, clockIn: true, contractWorker: { select: { id: true, name: true } } },
      });
      const period = await currentPeriod();
      const soon = period ? period.payPeriodEnd.getTime() - now.getTime() <= 2 * DAY_MS : false;
      return evaluateMissingClockOut(
        open.map((o) => ({ entryId: o.id, employeeId: o.contractWorker.id, employeeName: `${o.contractWorker.name} (contract)`, clockIn: o.clockIn, scheduledEnd: null })),
        policy,
        now,
        soon,
        "contract",
      );
    },
  },
  {
    id: "contract.entries",
    async run({ now }) {
      const since = new Date(businessToday(now).getTime() - 7 * DAY_MS);
      const rows = await db.contractTimeEntry.findMany({
        where: { date: { gte: since } },
        select: { id: true, date: true, jobCode: true, clockInPhotoKey: true, kioskSlug: true, contractWorker: { select: { id: true, name: true, jobCode: true } } },
      });
      return evaluateContractEntries(
        rows.map((r) => ({
          id: r.id,
          workerId: r.contractWorker.id,
          name: `${r.contractWorker.name} (contract)`,
          date: dateOnlyToString(r.date),
          jobCode: r.jobCode,
          workerJobCode: r.contractWorker.jobCode,
          hasPhotoIn: !!r.clockInPhotoKey,
          viaKiosk: !!r.kioskSlug,
        })),
        weekOf(dateOnlyToString(businessToday(now))),
      );
    },
  },
  {
    id: "contract.long-tenure",
    async run({ now, policy }) {
      const workers = await db.contractWorker.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true, startDate: true, agency: { select: { name: true } } },
      });
      return evaluateContractTenure(
        workers.map((w) => ({ id: w.id, name: w.name, agency: w.agency.name, startDate: w.startDate })),
        policy,
        now,
      );
    },
  },
];
