import { db } from "@/lib/db";
import { businessDateOnly } from "@/lib/format";
import { addDaysDateOnly, dateOnlyToString, startOfBusinessWeek } from "@/lib/time-rules";
import { OVERTIME_THRESHOLD_MIN } from "@/lib/payroll-overtime";
import { MAX_SHIFT_MS } from "@/lib/time-rules";

export type HoursWidgetPack = {
  pendingTimeApprovals: number;
  pendingLeave: number;
  pendingRequests: number;
  staleOpen: number;
  birthdays: Array<{ id: string; name: string; dateLabel: string }>;
  pendingTimeOff: Array<{
    id: string;
    name: string;
    start: string;
    end: string;
    type: string;
  }>;
  approachingOt: Array<{ id: string; name: string; weekMin: number; open: boolean }>;
  conflictingSegments: number;
  recentOt: Array<{ name: string; date: string; minutes: number }>;
};

/** Manager dashboard widgets that replace TCP home triage. */
export async function loadHoursWidgetPack(): Promise<HoursWidgetPack> {
  const today = businessDateOnly();
  const weekStart = startOfBusinessWeek(today);
  const weekEnd = addDaysDateOnly(weekStart, 6);
  const horizon = addDaysDateOnly(today, 14);
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - MAX_SHIFT_MS);

  const [
    pendingTimeApprovals,
    pendingLeave,
    pendingRequests,
    staleOpen,
    employees,
    leavePending,
    weekEntries,
    openEntries,
  ] = await Promise.all([
    db.timeEntry.count({
      where: { approvalStatus: "PENDING", clockOut: { not: null } },
    }),
    db.leaveRequest.count({ where: { status: "PENDING" } }),
    db.request.count({ where: { status: "PENDING" } }).catch(() => 0),
    db.timeEntry.count({
      where: { status: { in: ["ACTIVE", "ON_BREAK"] }, clockIn: { lt: staleCutoff } },
    }),
    db.employee.findMany({
      where: { employmentStatus: "ACTIVE", dateOfBirth: { not: null } },
      select: { id: true, name: true, dateOfBirth: true },
    }),
    db.leaveRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { startDate: "asc" },
      take: 8,
      select: {
        id: true,
        leaveType: true,
        startDate: true,
        endDate: true,
        employee: { select: { name: true } },
      },
    }),
    db.timeEntry.findMany({
      where: {
        date: { gte: weekStart, lte: weekEnd },
        approvalStatus: { not: "REJECTED" },
      },
      select: {
        employeeId: true,
        date: true,
        totalWorkMin: true,
        employee: { select: { name: true } },
      },
    }),
    db.timeEntry.findMany({
      where: { status: { in: ["ACTIVE", "ON_BREAK"] } },
      select: { employeeId: true },
    }),
  ]);

  const birthdays: HoursWidgetPack["birthdays"] = [];
  const y = today.getUTCFullYear();
  for (const e of employees) {
    if (!e.dateOfBirth) continue;
    const m = e.dateOfBirth.getUTCMonth();
    const d = e.dateOfBirth.getUTCDate();
    let next = new Date(Date.UTC(y, m, d));
    const todayKey = dateOnlyToString(today);
    if (dateOnlyToString(next) < todayKey) next = new Date(Date.UTC(y + 1, m, d));
    if (next <= horizon) {
      birthdays.push({
        id: e.id,
        name: e.name,
        dateLabel: `${String(m + 1).padStart(2, "0")}/${String(d).padStart(2, "0")}`,
      });
    }
  }
  birthdays.sort((a, b) => a.dateLabel.localeCompare(b.dateLabel));

  const weekMin = new Map<string, { name: string; minutes: number }>();
  for (const e of weekEntries) {
    const cur = weekMin.get(e.employeeId) ?? { name: e.employee.name, minutes: 0 };
    cur.minutes += e.totalWorkMin;
    weekMin.set(e.employeeId, cur);
  }
  const openSet = new Set(openEntries.map((e) => e.employeeId));
  const approachingOt = [...weekMin.entries()]
    .filter(([, v]) => v.minutes >= OVERTIME_THRESHOLD_MIN - 120)
    .map(([id, v]) => ({
      id,
      name: v.name,
      weekMin: v.minutes,
      open: openSet.has(id),
    }))
    .sort((a, b) => b.weekMin - a.weekMin)
    .slice(0, 8);

  // Overlapping closed/open segments same employee
  const recent = await db.timeEntry.findMany({
    where: { date: { gte: addDaysDateOnly(today, -14) } },
    select: {
      id: true,
      employeeId: true,
      clockIn: true,
      clockOut: true,
      totalWorkMin: true,
      employee: { select: { name: true } },
      date: true,
    },
    orderBy: { clockIn: "asc" },
    take: 2000,
  });
  const byEmp = new Map<string, typeof recent>();
  for (const e of recent) {
    const arr = byEmp.get(e.employeeId) ?? [];
    arr.push(e);
    byEmp.set(e.employeeId, arr);
  }
  let conflictingSegments = 0;
  for (const list of byEmp.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const aEnd = a.clockOut?.getTime() ?? now.getTime();
        const bEnd = b.clockOut?.getTime() ?? now.getTime();
        if (a.clockIn.getTime() < bEnd && b.clockIn.getTime() < aEnd) conflictingSegments += 1;
      }
    }
  }

  const recentOt = approachingOt
    .filter((a) => a.weekMin > OVERTIME_THRESHOLD_MIN)
    .slice(0, 12)
    .map((a) => ({
      name: a.name,
      date: dateOnlyToString(weekStart),
      minutes: a.weekMin - OVERTIME_THRESHOLD_MIN,
    }));

  return {
    pendingTimeApprovals,
    pendingLeave,
    pendingRequests,
    staleOpen,
    birthdays: birthdays.slice(0, 8),
    pendingTimeOff: leavePending.map((l) => ({
      id: l.id,
      name: l.employee.name,
      start: dateOnlyToString(l.startDate),
      end: dateOnlyToString(l.endDate),
      type: l.leaveType,
    })),
    approachingOt,
    conflictingSegments,
    recentOt,
  };
}
