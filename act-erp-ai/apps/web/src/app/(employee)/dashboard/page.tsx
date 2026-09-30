import Link from "next/link";
import { db } from "@/lib/db";
import { loadLeaveBalances } from "@/lib/leave-balance-db";
import { requireUser } from "@/lib/auth";
import { PageHeader, StatCard } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Banknote,
  Bell,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  Clock,
  Plane,
  Receipt,
  ClipboardList,
  TrendingUp,
} from "lucide-react";
import { BUSINESS_TIME_ZONE, formatBusinessTime, formatHours } from "@/lib/format";
import {
  addDateOnlyDays,
  businessDayKey,
  businessHour,
  dateOnlyShortLabel,
  dateOnlyWeekStart,
  scheduledInstant,
  scheduledRange,
  startOfBusinessMonth,
  startOfBusinessWeek,
} from "@/lib/business-time";
import { differenceInMinutes, formatDistanceToNow, subMonths } from "date-fns";
import {
  LeaveBalanceDonut,
  PaySnapshotChart,
  PersonalHoursTrend,
  PunctualityChart,
  ReimbursementTimelineChart,
  ScheduledVsWorkedChart,
  WeeklyHoursChart,
} from "@/components/charts/dashboard-charts";

export const metadata = { title: "Home" };

export default async function EmployeeHomePage() {
  const user = await requireUser();
  const employeeId = user.employeeId;
  const now = new Date();
  // Schedule/time-entry `date` columns are date-only (UTC midnight) values for
  // the BUSINESS (Central) calendar day, so every boundary below is date-only.
  const todayStart = businessDayKey(now);
  const weekStart = businessDayKey(startOfBusinessWeek(now));
  const monthStart = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth() + 1, 0));
  const next7End = addDateOnlyDays(todayStart, 7);
  const dk = (d: Date) => d.toISOString().slice(0, 10);

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };

  const employee = employeeId
    ? await safe(db.employee.findUnique({ where: { id: employeeId } }), null)
    : null;

  const [
    monthHours,
    todayEntry,
    weeklyEntries,
    monthlyEntries,
    upcomingShifts,
    pendingReimbs,
    pendingRequests,
    pendingLeave,
    unreadCount,
    recentNotifications,
  ] = await Promise.all([
    employeeId
      ? safe(
          db.timeEntry.aggregate({
            _sum: { totalWorkMin: true },
            where: { employeeId, date: { gte: monthStart, lte: monthEnd } },
          }),
          { _sum: { totalWorkMin: 0 } },
        )
      : Promise.resolve({ _sum: { totalWorkMin: 0 } }),
    employeeId
      ? safe(
          db.timeEntry.findFirst({
            where: { employeeId, status: { in: ["ACTIVE", "ON_BREAK"] } },
            orderBy: { clockIn: "desc" },
          }),
          null,
        )
      : Promise.resolve(null),
    employeeId
      ? safe(
          db.timeEntry.findMany({
            where: { employeeId, date: { gte: weekStart } },
            select: { date: true, totalWorkMin: true },
          }),
          [] as Array<{ date: Date; totalWorkMin: number }>,
        )
      : Promise.resolve([] as Array<{ date: Date; totalWorkMin: number }>),
    employeeId
      ? safe(
          db.timeEntry.findMany({
            where: { employeeId, date: { gte: monthStart, lte: monthEnd } },
            select: { date: true, totalWorkMin: true },
          }),
          [] as Array<{ date: Date; totalWorkMin: number }>,
        )
      : Promise.resolve([] as Array<{ date: Date; totalWorkMin: number }>),
    employeeId
      ? safe(
          db.schedule.findMany({
            where: {
              employeeId,
              date: { gte: todayStart, lte: next7End },
            },
            orderBy: [{ date: "asc" }, { startTime: "asc" }],
            take: 5,
          }),
          [],
        )
      : Promise.resolve([]),
    employeeId
      ? safe(
          db.reimbursement.count({
            where: {
              employeeId,
              status: { in: ["PENDING", "UNDER_REVIEW"] },
            },
          }),
          0,
        )
      : Promise.resolve(0),
    employeeId
      ? safe(
          db.request.count({
            where: { employeeId, status: { in: ["PENDING", "PROCESSING"] } },
          }),
          0,
        )
      : Promise.resolve(0),
    employeeId
      ? safe(
          db.leaveRequest.count({
            where: { employeeId, status: "PENDING" },
          }),
          0,
        )
      : Promise.resolve(0),
    employeeId
      ? safe(
          db.notificationRecipient.count({
            where: { employeeId, read: false },
          }),
          0,
        )
      : Promise.resolve(0),
    employeeId
      ? safe(
          db.notificationRecipient.findMany({
            where: { employeeId },
            orderBy: { notification: { createdAt: "desc" } },
            take: 4,
            include: {
              notification: {
                select: { title: true, message: true, createdAt: true, type: true },
              },
            },
          }),
          [],
        )
      : Promise.resolve([]),
  ]);

  // Build per-day buckets for the weekly hours chart (Mon-Sun) — still used
  // by the "Scheduled vs worked · this week" chart further down.
  const byDay = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    byDay.set(dk(addDateOnlyDays(weekStart, i)), 0);
  }
  for (const e of weeklyEntries) {
    const k = dk(e.date);
    byDay.set(k, (byDay.get(k) ?? 0) + e.totalWorkMin);
  }

  // Per-day buckets for the monthly hours chart. One entry per calendar day
  // of the current month. `weekday` lets the chart color each day distinctly.
  const monthDays = monthEnd.getUTCDate();
  const byDayMonth = new Map<string, number>();
  for (let i = 0; i < monthDays; i++) {
    byDayMonth.set(dk(addDateOnlyDays(monthStart, i)), 0);
  }
  for (const e of monthlyEntries) {
    const k = dk(e.date);
    if (byDayMonth.has(k)) {
      byDayMonth.set(k, (byDayMonth.get(k) ?? 0) + e.totalWorkMin);
    }
  }
  const monthlyChartData = Array.from(byDayMonth.entries()).map(([k, mins]) => {
    const d = new Date(k);
    return {
      day: String(d.getUTCDate()),
      hours: Math.round((mins / 60) * 10) / 10,
      weekday: d.getUTCDay(),
    };
  });

  // ─── Extra employee analytics (appended at bottom) ────────────────
  const trendStart = addDateOnlyDays(weekStart, -49); // last 8 weeks incl current
  const payStart = subMonths(now, 6);
  const punctualityStart = addDateOnlyDays(todayStart, -30);

  const [
    trendEntries,
    weekScheduled,
    leaveBalances,
    payCalendars,
    payEntries,
    employeeRate,
    reimbsMonthly,
    schedulesForPunctuality,
    entriesForPunctuality,
  ] = await Promise.all([
    employeeId
      ? safe(
          db.timeEntry.findMany({
            where: { employeeId, date: { gte: trendStart } },
            select: { date: true, totalWorkMin: true },
          }),
          [] as Array<{ date: Date; totalWorkMin: number }>,
        )
      : Promise.resolve([] as Array<{ date: Date; totalWorkMin: number }>),
    employeeId
      ? safe(
          db.schedule.findMany({
            where: { employeeId, date: { gte: weekStart, lte: addDateOnlyDays(weekStart, 6) } },
            select: { date: true, startTime: true, endTime: true },
          }),
          [] as Array<{ date: Date; startTime: string; endTime: string }>,
        )
      : Promise.resolve([] as Array<{ date: Date; startTime: string; endTime: string }>),
    // Leave balance from the shared policy-based loader (same source as the
    // Leave page and admin views).
    employeeId ? safe(loadLeaveBalances(employeeId), null) : Promise.resolve(null),
    safe(
      db.payrollCalendar.findMany({
        orderBy: { payPeriodEnd: "desc" },
        take: 6,
        select: { payPeriodStart: true, payPeriodEnd: true },
      }),
      [] as Array<{ payPeriodStart: Date; payPeriodEnd: Date }>,
    ),
    employeeId
      ? safe(
          db.timeEntry.findMany({
            where: { employeeId, date: { gte: subMonths(now, 8) } },
            select: { date: true, totalWorkMin: true, rate: true },
          }),
          [] as Array<{ date: Date; totalWorkMin: number; rate: unknown }>,
        )
      : Promise.resolve([] as Array<{ date: Date; totalWorkMin: number; rate: unknown }>),
    Promise.resolve(employee?.defaultHourlyRate ?? null),
    employeeId
      ? safe(
          db.reimbursement.findMany({
            where: { employeeId, createdAt: { gte: payStart } },
            select: { createdAt: true, status: true },
          }),
          [] as Array<{ createdAt: Date; status: string }>,
        )
      : Promise.resolve([] as Array<{ createdAt: Date; status: string }>),
    employeeId
      ? safe(
          db.schedule.findMany({
            where: { employeeId, date: { gte: punctualityStart, lte: todayStart } },
            select: { date: true, startTime: true },
          }),
          [] as Array<{ date: Date; startTime: string }>,
        )
      : Promise.resolve([] as Array<{ date: Date; startTime: string }>),
    employeeId
      ? safe(
          db.timeEntry.findMany({
            where: { employeeId, date: { gte: punctualityStart, lte: todayStart } },
            select: { date: true, clockIn: true },
            orderBy: { clockIn: "asc" },
          }),
          [] as Array<{ date: Date; clockIn: Date }>,
        )
      : Promise.resolve([] as Array<{ date: Date; clockIn: Date }>),
  ]);

  // 8-week personal hours trend
  const trendBuckets = new Map<string, number>();
  for (let i = 7; i >= 0; i--) {
    trendBuckets.set(dateOnlyShortLabel(addDateOnlyDays(weekStart, -7 * i)), 0);
  }
  for (const e of trendEntries) {
    const wk = dateOnlyShortLabel(dateOnlyWeekStart(e.date));
    if (trendBuckets.has(wk)) {
      trendBuckets.set(wk, (trendBuckets.get(wk) ?? 0) + e.totalWorkMin / 60);
    }
  }
  const personalTrendData = Array.from(trendBuckets.entries()).map(([week, hours]) => ({
    week,
    hours: Math.round(hours * 10) / 10,
  }));

  // Scheduled vs worked this week (per weekday)
  const scheduledByDay = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    scheduledByDay.set(dk(addDateOnlyDays(weekStart, i)), 0);
  }
  for (const s of weekScheduled) {
    const k = dk(s.date);
    if (!scheduledByDay.has(k)) continue;
    const range = scheduledRange(s.date, s.startTime, s.endTime);
    if (!range) continue;
    const mins = Math.max(0, differenceInMinutes(range.end, range.start));
    scheduledByDay.set(k, (scheduledByDay.get(k) ?? 0) + mins / 60);
  }
  const scheduledVsWorkedData = Array.from(byDay.entries()).map(([k, mins]) => ({
    day: new Date(k).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" }),
    scheduled: Math.round((scheduledByDay.get(k) ?? 0) * 10) / 10,
    worked: Math.round((mins / 60) * 10) / 10,
  }));

  // Leave balance breakdown
  // Donut slices are disjoint: taken (approved, dated up to today), approved
  // upcoming, and what's left after pending + approved (no double counting).
  const upcomingApprovedDays = leaveBalances?.totals.upcoming ?? 0;
  const taken = leaveBalances?.totals.taken ?? 0;
  const remaining = Math.max(0, leaveBalances?.totals.available ?? 0);

  // Pay snapshot · last 6 pay periods
  const defaultRate = Number(employeeRate ?? 25);
  const paySnapshotData =
    payCalendars.length === 0
      ? []
      : payCalendars
          .slice()
          .reverse()
          .map((p) => {
            let cost = 0;
            let hours = 0;
            for (const e of payEntries) {
              if (e.date < p.payPeriodStart || e.date > p.payPeriodEnd) continue;
              const rate = Number(e.rate ?? defaultRate);
              const hrs = e.totalWorkMin / 60;
              hours += hrs;
              cost += hrs * rate;
            }
            return {
              period: dateOnlyShortLabel(p.payPeriodEnd),
              estimate: Math.round(cost),
              hours: Math.round(hours),
            };
          });

  // Reimbursement timeline · last 6 months grouped by status
  const monthKey = (d: Date) =>
    d.toLocaleDateString("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "short" });
  const reimbursementBuckets = new Map<
    string,
    { month: string; PENDING: number; APPROVED: number; PAID: number; REJECTED: number }
  >();
  for (let i = 5; i >= 0; i--) {
    const key = monthKey(startOfBusinessMonth(now, i));
    reimbursementBuckets.set(key, {
      month: key,
      PENDING: 0,
      APPROVED: 0,
      PAID: 0,
      REJECTED: 0,
    });
  }
  for (const r of reimbsMonthly) {
    const key = monthKey(r.createdAt);
    const b = reimbursementBuckets.get(key);
    if (!b) continue;
    if (r.status === "PENDING" || r.status === "UNDER_REVIEW") b.PENDING += 1;
    else if (r.status === "APPROVED") b.APPROVED += 1;
    else if (r.status === "PAID" || r.status === "REIMBURSED") b.PAID += 1;
    else if (r.status === "REJECTED") b.REJECTED += 1;
  }
  const reimbursementTimelineData = Array.from(reimbursementBuckets.values());

  // Punctuality · last 30 days
  const entriesByDate = new Map<string, Date>();
  for (const e of entriesForPunctuality) {
    const k = dk(e.date);
    if (!entriesByDate.has(k)) entriesByDate.set(k, e.clockIn);
  }
  let onTime = 0;
  let late = 0;
  let missed = 0;
  for (const s of schedulesForPunctuality) {
    const k = dk(s.date);
    // Scheduled wall-clock time (business timezone) on the schedule's date.
    const scheduled = scheduledInstant(s.date, s.startTime);
    if (!scheduled) continue;
    const ci = entriesByDate.get(k);
    if (!ci) {
      // A shift that has not started yet is not "missed".
      if (scheduled <= now) missed += 1;
      continue;
    }
    const diff = differenceInMinutes(ci, scheduled);
    if (diff <= 10) onTime += 1;
    else late += 1;
  }

  const hour = businessHour(now);
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user.name.split(" ")[0];

  const totalLeaves = leaveBalances?.totals.allowed ?? 0;
  const leavesRemaining = leaveBalances?.totals.available ?? 0;
  const leavesUsedPct =
    totalLeaves > 0
      ? Math.round(((leaveBalances?.totals.used ?? 0) / totalLeaves) * 100)
      : 0;

  const todayShift = upcomingShifts.find(
    (s) => s.date.getTime() === todayStart.getTime(),
  );

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={
          todayEntry
            ? `You're currently ${todayEntry.status === "ON_BREAK" ? "on break" : "clocked in"}.`
            : "You're currently clocked out."
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/time-tracking">
              <Clock className="mr-2 h-4 w-4" /> View timesheet
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Hours this month"
          value={formatHours(monthHours._sum.totalWorkMin ?? 0)}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Leave remaining"
          value={`${leavesRemaining} / ${totalLeaves || "—"} days`}
          icon={<Plane className="h-4 w-4" />}
          delta={totalLeaves > 0 ? { value: `${leavesUsedPct}% used` } : undefined}
        />
        <StatCard
          label="Pending reimbursements"
          value={pendingReimbs}
          icon={<Receipt className="h-4 w-4" />}
        />
        <StatCard
          label="Unread notifications"
          value={unreadCount}
          icon={<Bell className="h-4 w-4" />}
        />
      </div>

      {/* Top row: weekly hours chart + today's shift */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" /> Hours this month
            </CardTitle>
            <CardDescription>
              Daily hours clocked across {now.toLocaleDateString("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "long", year: "numeric" })} (
              {formatHours(monthHours._sum.totalWorkMin ?? 0)} total).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WeeklyHoursChart data={monthlyChartData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-primary" /> Today
            </CardTitle>
            <CardDescription>
              {todayShift
                ? `Scheduled ${todayShift.startTime}–${todayShift.endTime}`
                : "No shift scheduled today."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Status
              </p>
              <p className="mt-1 text-base font-semibold">
                {todayEntry
                  ? todayEntry.status === "ON_BREAK"
                    ? "On break"
                    : "Clocked in"
                  : "Clocked out"}
              </p>
              {todayEntry && (
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  Since {formatBusinessTime(todayEntry.clockIn)} · {todayEntry.jobCode}
                </p>
              )}
            </div>
            {todayShift && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Today&apos;s shift
                </p>
                <p className="mt-1 font-mono text-sm">
                  {todayShift.startTime} → {todayShift.endTime}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {todayShift.jobCode}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: upcoming shifts, action items, notifications */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="h-4 w-4 text-primary" /> Upcoming shifts
              </CardTitle>
              <CardDescription>Next 7 days.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
              <Link href="/dashboard/schedule">
                View all <ChevronRight className="ml-0.5 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {upcomingShifts.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No shifts scheduled.
              </p>
            ) : (
              <ul className="divide-y">
                {upcomingShifts.map((s) => (
                  <li
                    key={s.id}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5"
                  >
                    <div className="flex h-9 w-9 flex-col items-center justify-center rounded-md border bg-muted/30 text-center">
                      <span className="text-[9px] uppercase text-muted-foreground">
                        {s.date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })}
                      </span>
                      <span className="text-sm font-semibold leading-none">
                        {s.date.getUTCDate()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{s.date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" })}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {s.startTime} → {s.endTime} · {s.jobCode}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-primary" /> Action items
            </CardTitle>
            <CardDescription>Things waiting on you or admin.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              <ActionItemRow
                label="Pending requests"
                count={pendingRequests}
                href="/dashboard/requests"
              />
              <ActionItemRow
                label="Pending leave"
                count={pendingLeave}
                href="/dashboard/leave"
              />
              <ActionItemRow
                label="Pending reimbursements"
                count={pendingReimbs}
                href="/dashboard/reimbursements"
              />
              <ActionItemRow
                label="Unread notifications"
                count={unreadCount}
                href="/dashboard/notifications"
              />
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4 text-primary" /> Notifications
              </CardTitle>
              <CardDescription>Latest activity.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
              <Link href="/dashboard/notifications">
                View all <ChevronRight className="ml-0.5 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentNotifications.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Nothing yet.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {recentNotifications.map((r) => (
                  <li key={r.id} className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        r.read ? "bg-muted-foreground/40" : "bg-primary"
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {r.notification.title}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {formatDistanceToNow(r.notification.createdAt, {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* New analytics — appended below for evaluation                */}
      {/* ─────────────────────────────────────────────────────────── */}

      <div className="mb-3 mt-10 flex items-center gap-2">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          New analytics
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarCheck className="h-4 w-4 text-primary" /> Scheduled vs worked ·
              this week
            </CardTitle>
            <CardDescription>
              Daily side-by-side of what you were scheduled and what you logged.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScheduledVsWorkedChart data={scheduledVsWorkedData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" /> Hours trend · last 8 weeks
            </CardTitle>
            <CardDescription>
              Your weekly hours, with the 40h reference line.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PersonalHoursTrend data={personalTrendData} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plane className="h-4 w-4 text-primary" /> Leave balance
            </CardTitle>
            <CardDescription>
              Days taken, approved upcoming, and remaining.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LeaveBalanceDonut
              taken={taken}
              approved={upcomingApprovedDays}
              remaining={remaining}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-4 w-4 text-primary" /> Pay snapshot · last 6 periods
            </CardTitle>
            <CardDescription>
              Estimated gross from logged hours × your rate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PaySnapshotChart data={paySnapshotData} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4 text-primary" /> Reimbursements · last 6 months
            </CardTitle>
            <CardDescription>
              Submissions per month, stacked by current status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReimbursementTimelineChart data={reimbursementTimelineData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" /> Punctuality · last 30 days
            </CardTitle>
            <CardDescription>
              On-time within 10 min of scheduled start, vs late or missed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PunctualityChart onTime={onTime} late={late} missed={missed} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function ActionItemRow({
  label,
  count,
  href,
}: {
  label: string;
  count: number;
  href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted"
      >
        <span>{label}</span>
        <span className="flex items-center gap-1.5">
          <Badge variant={count > 0 ? "default" : "secondary"} className="font-mono">
            {count}
          </Badge>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      </Link>
    </li>
  );
}
