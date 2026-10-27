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
import { BUSINESS_TIME_ZONE, formatHours } from "@/lib/format";
import {
  addDateOnlyDays,
  businessDayKey,
  businessHour,
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
import { getPortalLanguage } from "@/lib/portal-i18n/server";
import { localizeNotification } from "@/lib/portal-i18n/notifications";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("home.title") };
}

export default async function EmployeeHomePage() {
  const translator = await getPortalLanguage();
  const { t, locale, dateFnsLocale, formatDate, formatDateOnly, formatTime, enumLabel } =
    translator;
  const user = await requireUser();
  const employeeId = user.employeeId;
  const now = new Date();
  // Schedule/time-entry `date` columns are date-only (UTC midnight) values for
  // the BUSINESS (Central) calendar day, so every boundary below is date-only.
  const todayStart = businessDayKey(now);
  const weekStart = businessDayKey(startOfBusinessWeek(now));
  const monthStart = new Date(
    Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth() + 1, 0),
  );
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
                select: {
                  title: true,
                  message: true,
                  createdAt: true,
                  type: true,
                  translationKey: true,
                  translationParams: true,
                },
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
            where: {
              employeeId,
              date: { gte: weekStart, lte: addDateOnlyDays(weekStart, 6) },
            },
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
    trendBuckets.set(dk(dateOnlyWeekStart(addDateOnlyDays(weekStart, -7 * i))), 0);
  }
  for (const e of trendEntries) {
    const wk = dk(dateOnlyWeekStart(e.date));
    if (trendBuckets.has(wk)) {
      trendBuckets.set(wk, (trendBuckets.get(wk) ?? 0) + e.totalWorkMin / 60);
    }
  }
  const personalTrendData = Array.from(trendBuckets.entries()).map(([week, hours]) => ({
    week: new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }).format(new Date(week)),
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
    day: new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" }).format(
      new Date(k),
    ),
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
              period: formatDateOnly(p.payPeriodEnd),
              estimate: Math.round(cost),
              hours: Math.round(hours),
            };
          });

  // Reimbursement timeline · last 6 months grouped by status
  const monthKey = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(d);
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    return `${year}-${month}`;
  };
  const monthLabel = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: BUSINESS_TIME_ZONE,
      month: "short",
    }).format(d);
  const reimbursementBuckets = new Map<
    string,
    { month: string; PENDING: number; APPROVED: number; PAID: number; REJECTED: number }
  >();
  for (let i = 5; i >= 0; i--) {
    const key = monthKey(startOfBusinessMonth(now, i));
    reimbursementBuckets.set(key, {
      month: monthLabel(startOfBusinessMonth(now, i)),
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
    hour < 12
      ? "home.greeting.morning"
      : hour < 18
        ? "home.greeting.afternoon"
        : "home.greeting.evening";
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
        title={t(greeting, { name: firstName })}
        description={
          todayEntry
            ? t("home.currentStatus", {
                status: t(
                  todayEntry.status === "ON_BREAK"
                    ? "home.status.onBreak"
                    : "home.status.clockedIn",
                ),
              })
            : t("home.currentStatus", { status: t("home.status.clockedOut") })
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/time-tracking">
              <Clock className="mr-2 h-4 w-4" /> {t("home.viewTimesheet")}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("home.hoursThisMonth")}
          value={formatHours(monthHours._sum.totalWorkMin ?? 0)}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label={t("home.leaveRemaining")}
          value={t("home.leaveDaysValue", {
            remaining: new Intl.NumberFormat(locale).format(leavesRemaining),
            total: totalLeaves ? new Intl.NumberFormat(locale).format(totalLeaves) : "—",
          })}
          icon={<Plane className="h-4 w-4" />}
          delta={
            totalLeaves > 0
              ? {
                  value: t("home.leaveUsed", {
                    percent: new Intl.NumberFormat(locale).format(leavesUsedPct),
                  }),
                }
              : undefined
          }
        />
        <StatCard
          label={t("home.pendingReimbursements")}
          value={new Intl.NumberFormat(locale).format(pendingReimbs)}
          icon={<Receipt className="h-4 w-4" />}
        />
        <StatCard
          label={t("home.unreadNotifications")}
          value={new Intl.NumberFormat(locale).format(unreadCount)}
          icon={<Bell className="h-4 w-4" />}
        />
      </div>

      {/* Top row: weekly hours chart + today's shift */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" /> {t("home.hoursThisMonth")}
            </CardTitle>
            <CardDescription>
              {t("home.dailyHoursSummary", {
                month: formatDate(now, { month: "long", year: "numeric" }),
                hours: formatHours(monthHours._sum.totalWorkMin ?? 0),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WeeklyHoursChart data={monthlyChartData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-primary" /> {t("home.today")}
            </CardTitle>
            <CardDescription>
              {todayShift
                ? t("home.scheduledTime", {
                    start: todayShift.startTime,
                    end: todayShift.endTime,
                  })
                : t("home.noShiftToday")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {t("home.statusLabel")}
              </p>
              <p className="mt-1 text-base font-semibold">
                {todayEntry
                  ? todayEntry.status === "ON_BREAK"
                    ? t("home.status.onBreak")
                    : t("home.status.clockedIn")
                  : t("home.status.clockedOut")}
              </p>
              {todayEntry && (
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {t("home.since", { time: formatTime(todayEntry.clockIn) })} ·{" "}
                  {todayEntry.jobCode}
                </p>
              )}
            </div>
            {todayShift && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t("home.todaysShift")}
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
                <CalendarDays className="h-4 w-4 text-primary" />{" "}
                {t("home.upcomingShifts")}
              </CardTitle>
              <CardDescription>{t("home.next7Days")}</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
              <Link href="/dashboard/schedule">
                {t("home.viewAll")} <ChevronRight className="ml-0.5 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {upcomingShifts.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {t("home.noShiftsScheduled")}
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
                        {new Intl.DateTimeFormat(locale, {
                          timeZone: "UTC",
                          month: "short",
                        }).format(s.date)}
                      </span>
                      <span className="text-sm font-semibold leading-none">
                        {s.date.getUTCDate()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {new Intl.DateTimeFormat(locale, {
                          timeZone: "UTC",
                          weekday: "long",
                        }).format(s.date)}
                      </p>
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
              <ClipboardList className="h-4 w-4 text-primary" /> {t("home.actionItems")}
            </CardTitle>
            <CardDescription>{t("home.actionItemsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              <ActionItemRow
                label={t("home.pendingRequests")}
                count={pendingRequests}
                displayCount={new Intl.NumberFormat(locale).format(pendingRequests)}
                href="/dashboard/requests"
              />
              <ActionItemRow
                label={t("home.pendingLeave")}
                count={pendingLeave}
                displayCount={new Intl.NumberFormat(locale).format(pendingLeave)}
                href="/dashboard/leave"
              />
              <ActionItemRow
                label={t("home.pendingReimbursements")}
                count={pendingReimbs}
                displayCount={new Intl.NumberFormat(locale).format(pendingReimbs)}
                href="/dashboard/reimbursements"
              />
              <ActionItemRow
                label={t("home.unreadNotifications")}
                count={unreadCount}
                displayCount={new Intl.NumberFormat(locale).format(unreadCount)}
                href="/dashboard/notifications"
              />
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4 text-primary" /> {t("home.notifications")}
              </CardTitle>
              <CardDescription>{t("home.latestActivity")}</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
              <Link href="/dashboard/notifications">
                {t("home.viewAll")} <ChevronRight className="ml-0.5 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentNotifications.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {t("home.noNotifications")}
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
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge variant="outline" className="shrink-0 text-[9px]">
                          {enumLabel(r.notification.type)}
                        </Badge>
                        <p className="truncate text-sm font-medium">
                          {localizeNotification(r.notification, translator).title}
                        </p>
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {formatDistanceToNow(r.notification.createdAt, {
                          addSuffix: true,
                          locale: dateFnsLocale,
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
          {t("home.newAnalytics")}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarCheck className="h-4 w-4 text-primary" />{" "}
              {t("home.scheduledVsWorkedTitle")}
            </CardTitle>
            <CardDescription>{t("home.scheduledVsWorkedDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ScheduledVsWorkedChart data={scheduledVsWorkedData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" /> {t("home.hoursTrendTitle")}
            </CardTitle>
            <CardDescription>{t("home.hoursTrendDescription")}</CardDescription>
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
              <Plane className="h-4 w-4 text-primary" /> {t("home.leaveBalance")}
            </CardTitle>
            <CardDescription>{t("home.leaveBalanceDescription")}</CardDescription>
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
              <Banknote className="h-4 w-4 text-primary" /> {t("home.paySnapshotTitle")}
            </CardTitle>
            <CardDescription>{t("home.paySnapshotDescription")}</CardDescription>
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
              <Receipt className="h-4 w-4 text-primary" />{" "}
              {t("home.reimbursementsTrendTitle")}
            </CardTitle>
            <CardDescription>{t("home.reimbursementsTrendDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReimbursementTimelineChart data={reimbursementTimelineData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" /> {t("home.punctualityTitle")}
            </CardTitle>
            <CardDescription>{t("home.punctualityDescription")}</CardDescription>
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
  displayCount,
  href,
}: {
  label: string;
  count: number;
  displayCount: string;
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
            {displayCount}
          </Badge>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      </Link>
    </li>
  );
}
