import { db } from "@/lib/db";
import {
  addDays,
  differenceInHours,
  differenceInMinutes,
  endOfDay,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";

const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
  try { return await p; } catch { return fallback; }
};

/** Hours by department for the last `weeks` weeks. */
export async function hoursByDepartmentWeekly(weeks = 4) {
  const since = subWeeks(new Date(), weeks);
  const rows = await safe(
    db.timeEntry.findMany({
      where: { date: { gte: since } },
      select: {
        date: true,
        totalWorkMin: true,
        employee: { select: { department: { select: { name: true } } } },
      },
    }),
    [] as Array<{ date: Date; totalWorkMin: number; employee: { department: { name: string } | null } }>,
  );

  const buckets = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const wk = format(startOfWeek(r.date, { weekStartsOn: 1 }), "MMM d");
    const dept = r.employee.department?.name ?? "Other";
    const bucket = buckets.get(wk) ?? {};
    bucket[dept] = (bucket[dept] ?? 0) + r.totalWorkMin / 60;
    buckets.set(wk, bucket);
  }

  return Array.from(buckets.entries()).map(([week, depts]) => ({
    week,
    ...Object.fromEntries(Object.entries(depts).map(([k, v]) => [k, Math.round(v)])),
  }));
}

/** Org-wide hours per ISO week — last 12 weeks. */
export async function hoursTrendWeekly(weeks = 12) {
  const since = subWeeks(new Date(), weeks);
  const rows = await safe(
    db.timeEntry.findMany({
      where: { date: { gte: since } },
      select: { date: true, totalWorkMin: true },
    }),
    [] as Array<{ date: Date; totalWorkMin: number }>,
  );
  const buckets = new Map<string, number>();
  for (const r of rows) {
    const wk = format(startOfWeek(r.date, { weekStartsOn: 1 }), "MMM d");
    buckets.set(wk, (buckets.get(wk) ?? 0) + r.totalWorkMin / 60);
  }
  return Array.from(buckets.entries()).map(([week, hours]) => ({
    week,
    hours: Math.round(hours),
  }));
}

/** Headcount per department. */
export async function departmentHeadcount() {
  const rows = await safe(
    db.employee.groupBy({
      by: ["departmentId"],
      _count: true,
      where: { employmentStatus: "ACTIVE" },
    }),
    [] as Array<{ departmentId: string | null; _count: number }>,
  );
  if (rows.length === 0) return [];
  const depts = await db.department.findMany({
    where: { id: { in: rows.map((r) => r.departmentId).filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  const nameById = Object.fromEntries(depts.map((d) => [d.id, d.name]));
  return rows
    .filter((r) => r.departmentId)
    .map((r) => ({
      department: nameById[r.departmentId!] ?? "—",
      count: r._count,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Leave types this year. */
export async function leaveTypesThisYear() {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const rows = await safe(
    db.leaveRequest.groupBy({
      by: ["leaveType"],
      _count: true,
      where: { createdAt: { gte: yearStart }, status: { in: ["APPROVED", "PENDING"] } },
    }),
    [] as Array<{ leaveType: string; _count: number }>,
  );
  return rows.map((r) => ({ type: r.leaveType, count: r._count }));
}

/** Reimbursement spend by category, last 12 months. */
export async function reimbursementCategoryTotals() {
  const since = subMonths(new Date(), 12);
  const rows = await safe(
    db.reimbursement.groupBy({
      by: ["category"],
      _sum: { amount: true },
      _count: true,
      where: { createdAt: { gte: since } },
    }),
    [] as Array<{ category: string; _sum: { amount: unknown }; _count: number }>,
  );
  return rows
    .map((r) => ({
      category: r.category,
      total: Number(r._sum.amount ?? 0),
      count: r._count,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Cumulative headcount by month over the last 6 years. */
export async function headcountGrowth() {
  const employees = await safe(
    db.employee.findMany({
      select: { dateOfHire: true, terminationDate: true, employmentStatus: true },
    }),
    [] as Array<{ dateOfHire: Date | null; terminationDate: Date | null; employmentStatus: string }>,
  );

  const months: { month: string; count: number }[] = [];
  for (let i = 71; i >= 0; i--) {
    const m = startOfMonth(subMonths(new Date(), i));
    const count = employees.filter((e) => {
      if (!e.dateOfHire) return false;
      if (e.dateOfHire > m) return false;
      if (e.terminationDate && e.terminationDate <= m) return false;
      return true;
    }).length;
    months.push({ month: format(m, "MMM yy"), count });
  }
  return months;
}

/** Top N employees by hours this week. */
export async function topEmployeesThisWeek(n = 10) {
  const start = startOfWeek(new Date(), { weekStartsOn: 1 });
  const grouped = await safe(
    db.timeEntry.groupBy({
      by: ["employeeId"],
      _sum: { totalWorkMin: true },
      where: { date: { gte: start } },
      orderBy: { _sum: { totalWorkMin: "desc" } },
      take: n,
    }),
    [] as Array<{ employeeId: string; _sum: { totalWorkMin: number | null } }>,
  );
  if (grouped.length === 0) return [];
  const employees = await db.employee.findMany({
    where: { id: { in: grouped.map((g) => g.employeeId) } },
    select: { id: true, name: true, profilePic: true, email: true },
  });
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
  return grouped
    .map((g) => ({
      id: g.employeeId,
      name: byId[g.employeeId]?.name ?? "—",
      email: byId[g.employeeId]?.email ?? "",
      profilePic: byId[g.employeeId]?.profilePic ?? null,
      hours: Math.round((g._sum.totalWorkMin ?? 0) / 60),
    }))
    .filter((r) => r.hours > 0);
}

/** Last-50 audit-log events for the activity feed. */
export async function recentActivity() {
  return safe(
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        action: true,
        resource: true,
        actorEmail: true,
        createdAt: true,
      },
    }),
    [],
  );
}

// ──────────────────────────────────────────────────────────────────────
// Extra admin charts (appended at bottom of admin home)
// ──────────────────────────────────────────────────────────────────────

/** Clocked-in vs scheduled-right-now snapshot. */
export async function clockedVsScheduled() {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = endOfDay(now);
  const [clockedInRows, scheduledToday] = await Promise.all([
    safe(
      db.timeEntry.findMany({
        where: { status: { in: ["ACTIVE", "ON_BREAK"] } },
        select: { employeeId: true },
      }),
      [] as Array<{ employeeId: string }>,
    ),
    safe(
      db.scheduledWork.findMany({
        where: { date: { gte: today, lte: tomorrow } },
        select: { employeeId: true, startTime: true, endTime: true },
      }),
      [] as Array<{ employeeId: string; startTime: Date; endTime: Date }>,
    ),
  ]);
  const clockedIds = new Set(clockedInRows.map((r) => r.employeeId));
  const scheduledNow = scheduledToday.filter(
    (s) => s.startTime <= now && s.endTime >= now,
  );
  const scheduledIds = new Set(scheduledNow.map((s) => s.employeeId));
  const noShow = [...scheduledIds].filter((id) => !clockedIds.has(id)).length;
  const unscheduledClockedIn = [...clockedIds].filter((id) => !scheduledIds.has(id)).length;
  return {
    clockedIn: clockedIds.size,
    scheduledNow: scheduledIds.size,
    noShow,
    unscheduledClockedIn,
    scheduledTodayTotal: scheduledToday.length,
  };
}

/** Per-department headcount + last-7-day utilization (worked / scheduled %). */
export async function departmentUtilization() {
  const since = subDays(startOfDay(new Date()), 7);
  const [depts, employees, entries, scheduled] = await Promise.all([
    safe(db.department.findMany({ select: { id: true, name: true } }), []),
    safe(
      db.employee.findMany({
        where: { employmentStatus: "ACTIVE" },
        select: { id: true, departmentId: true },
      }),
      [] as Array<{ id: string; departmentId: string | null }>,
    ),
    safe(
      db.timeEntry.findMany({
        where: { date: { gte: since } },
        select: { totalWorkMin: true, employeeId: true },
      }),
      [] as Array<{ totalWorkMin: number; employeeId: string }>,
    ),
    safe(
      db.scheduledWork.findMany({
        where: { date: { gte: since } },
        select: { startTime: true, endTime: true, totalBreakMin: true, employeeId: true },
      }),
      [] as Array<{ startTime: Date; endTime: Date; totalBreakMin: number; employeeId: string }>,
    ),
  ]);
  const deptByEmp = new Map(employees.map((e) => [e.id, e.departmentId]));
  const headByDept = new Map<string, number>();
  for (const e of employees) {
    if (!e.departmentId) continue;
    headByDept.set(e.departmentId, (headByDept.get(e.departmentId) ?? 0) + 1);
  }
  const workedByDept = new Map<string, number>();
  for (const t of entries) {
    const d = deptByEmp.get(t.employeeId);
    if (!d) continue;
    workedByDept.set(d, (workedByDept.get(d) ?? 0) + t.totalWorkMin / 60);
  }
  const scheduledByDept = new Map<string, number>();
  for (const s of scheduled) {
    const d = deptByEmp.get(s.employeeId);
    if (!d) continue;
    const mins = differenceInMinutes(s.endTime, s.startTime) - (s.totalBreakMin ?? 0);
    scheduledByDept.set(d, (scheduledByDept.get(d) ?? 0) + Math.max(0, mins) / 60);
  }
  return depts
    .map((d) => {
      const sched = Math.round(scheduledByDept.get(d.id) ?? 0);
      const worked = Math.round(workedByDept.get(d.id) ?? 0);
      const utilization = sched > 0 ? Math.round((worked / sched) * 100) : 0;
      return {
        department: d.name,
        headcount: headByDept.get(d.id) ?? 0,
        scheduled: sched,
        worked,
        utilization,
      };
    })
    .filter((r) => r.headcount > 0 || r.scheduled > 0 || r.worked > 0)
    .sort((a, b) => b.headcount - a.headcount);
}

/** Estimated payroll cost for the last 6 pay periods. */
export async function payrollCostTrend(periods = 6) {
  const calendars = await safe(
    db.payrollCalendar.findMany({
      orderBy: { payPeriodEnd: "desc" },
      take: periods,
      select: { id: true, title: true, payPeriodStart: true, payPeriodEnd: true, payDate: true, status: true },
    }),
    [] as Array<{ id: string; title: string; payPeriodStart: Date; payPeriodEnd: Date; payDate: Date; status: string }>,
  );
  if (calendars.length === 0) return [];
  const oldest = calendars[calendars.length - 1].payPeriodStart;
  const newest = calendars[0].payPeriodEnd;
  const entries = await safe(
    db.timeEntry.findMany({
      where: { date: { gte: oldest, lte: newest } },
      select: {
        date: true,
        totalWorkMin: true,
        rate: true,
        employee: { select: { defaultHourlyRate: true } },
      },
    }),
    [] as Array<{ date: Date; totalWorkMin: number; rate: unknown; employee: { defaultHourlyRate: unknown } }>,
  );
  return calendars
    .slice()
    .reverse()
    .map((p) => {
      let cost = 0;
      let hours = 0;
      for (const e of entries) {
        if (e.date < p.payPeriodStart || e.date > p.payPeriodEnd) continue;
        const rate = Number(e.rate ?? e.employee.defaultHourlyRate ?? 25);
        const hrs = e.totalWorkMin / 60;
        hours += hrs;
        cost += hrs * rate;
      }
      return {
        period: format(p.payPeriodEnd, "MMM d"),
        cost: Math.round(cost),
        hours: Math.round(hours),
        status: p.status,
      };
    });
}

/** Top employees this week by hours, with weekly threshold for OT highlighting. */
export async function overtimeRiskWeek(n = 8) {
  const start = startOfWeek(new Date(), { weekStartsOn: 1 });
  const grouped = await safe(
    db.timeEntry.groupBy({
      by: ["employeeId"],
      _sum: { totalWorkMin: true },
      where: { date: { gte: start } },
      orderBy: { _sum: { totalWorkMin: "desc" } },
      take: n,
    }),
    [] as Array<{ employeeId: string; _sum: { totalWorkMin: number | null } }>,
  );
  if (grouped.length === 0) return [];
  const employees = await db.employee.findMany({
    where: { id: { in: grouped.map((g) => g.employeeId) } },
    select: { id: true, name: true, profilePic: true, email: true, department: { select: { name: true } } },
  });
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
  return grouped
    .map((g) => {
      const hours = Math.round(((g._sum.totalWorkMin ?? 0) / 60) * 10) / 10;
      return {
        id: g.employeeId,
        name: byId[g.employeeId]?.name ?? "—",
        department: byId[g.employeeId]?.department?.name ?? "—",
        profilePic: byId[g.employeeId]?.profilePic ?? null,
        hours,
        overtime: hours > 40,
      };
    })
    .filter((r) => r.hours > 0);
}

/** Aging buckets across all 4 approval queues. */
export async function pendingApprovalsAging() {
  const now = new Date();
  const bucket = (d: Date) => {
    const h = differenceInHours(now, d);
    if (h < 24) return "<24h";
    if (h < 72) return "1-3d";
    if (h < 168) return "3-7d";
    return ">7d";
  };
  const [time, leave, req, reimb] = await Promise.all([
    safe(
      db.timeEntry.findMany({
        where: { approvalStatus: "PENDING", clockOut: { not: null } },
        select: { createdAt: true },
      }),
      [] as Array<{ createdAt: Date }>,
    ),
    safe(
      db.leaveRequest.findMany({
        where: { status: "PENDING" },
        select: { createdAt: true },
      }),
      [] as Array<{ createdAt: Date }>,
    ),
    safe(
      db.request.findMany({
        where: { status: { in: ["PENDING", "PROCESSING"] } },
        select: { createdAt: true },
      }),
      [] as Array<{ createdAt: Date }>,
    ),
    safe(
      db.reimbursement.findMany({
        where: { status: { in: ["PENDING", "UNDER_REVIEW"] } },
        select: { createdAt: true },
      }),
      [] as Array<{ createdAt: Date }>,
    ),
  ]);
  const buckets = ["<24h", "1-3d", "3-7d", ">7d"] as const;
  const queues = [
    { name: "Timesheets", rows: time },
    { name: "Leave", rows: leave },
    { name: "Requests", rows: req },
    { name: "Reimbursements", rows: reimb },
  ];
  return buckets.map((b) => {
    const entry: Record<string, string | number> = { age: b };
    for (const q of queues) {
      entry[q.name] = q.rows.filter((r) => bucket(r.createdAt) === b).length;
    }
    return entry;
  });
}

/** Daily count of approved leaves overlapping each of the next 30 days. */
export async function leaveHeatmap30() {
  const today = startOfDay(new Date());
  const horizon = endOfDay(addDays(today, 29));
  const rows = await safe(
    db.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        startDate: { lte: horizon },
        endDate: { gte: today },
      },
      select: { startDate: true, endDate: true, leaveType: true },
    }),
    [] as Array<{ startDate: Date; endDate: Date; leaveType: string }>,
  );
  const days: Array<{ date: string; label: string; count: number; weekday: number }> = [];
  for (let i = 0; i < 30; i++) {
    const d = addDays(today, i);
    const day = startOfDay(d);
    const count = rows.filter(
      (r) => startOfDay(r.startDate) <= day && startOfDay(r.endDate) >= day,
    ).length;
    days.push({
      date: format(d, "yyyy-MM-dd"),
      label: format(d, "MMM d"),
      count,
      weekday: d.getDay(),
    });
  }
  return days;
}

/** Request type funnel + median time-to-decision (last 90 days). */
export async function requestsFunnel90() {
  const since = subDays(new Date(), 90);
  const rows = await safe(
    db.request.findMany({
      where: { createdAt: { gte: since } },
      select: { type: true, status: true, createdAt: true, updatedAt: true },
    }),
    [] as Array<{ type: string; status: string; createdAt: Date; updatedAt: Date }>,
  );
  const byType = new Map<
    string,
    { type: string; pending: number; approved: number; rejected: number; other: number; ttls: number[] }
  >();
  for (const r of rows) {
    const k = r.type;
    if (!byType.has(k))
      byType.set(k, { type: k, pending: 0, approved: 0, rejected: 0, other: 0, ttls: [] });
    const b = byType.get(k)!;
    if (r.status === "PENDING" || r.status === "PROCESSING") b.pending++;
    else if (r.status === "APPROVED") b.approved++;
    else if (r.status === "REJECTED") b.rejected++;
    else b.other++;
    if (r.status !== "PENDING" && r.status !== "PROCESSING") {
      b.ttls.push(differenceInHours(r.updatedAt, r.createdAt));
    }
  }
  return Array.from(byType.values())
    .map((b) => {
      const sorted = b.ttls.slice().sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      const total = b.pending + b.approved + b.rejected + b.other;
      return {
        type: b.type.replace(/_/g, " "),
        total,
        pending: b.pending,
        approved: b.approved,
        rejected: b.rejected,
        other: b.other,
        medianHours: median,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/** Bundle for the new admin "extras" section. */
export async function dashboardExtras() {
  const [clocked, deptUtil, payroll, overtime, aging, leaveHeat, funnel] = await Promise.all([
    clockedVsScheduled(),
    departmentUtilization(),
    payrollCostTrend(6),
    overtimeRiskWeek(8),
    pendingApprovalsAging(),
    leaveHeatmap30(),
    requestsFunnel90(),
  ]);
  return { clocked, deptUtil, payroll, overtime, aging, leaveHeat, funnel };
}

/** All chart data in one batch — used by the admin home. */
export async function dashboardData() {
  const [byDept, trend, headcountByDept, leaveTypes, reimbCats, growth, topEmployees, activity] = await Promise.all([
    hoursByDepartmentWeekly(4),
    hoursTrendWeekly(12),
    departmentHeadcount(),
    leaveTypesThisYear(),
    reimbursementCategoryTotals(),
    headcountGrowth(),
    topEmployeesThisWeek(10),
    recentActivity(),
  ]);
  return { byDept, trend, headcountByDept, leaveTypes, reimbCats, growth, topEmployees, activity };
}
