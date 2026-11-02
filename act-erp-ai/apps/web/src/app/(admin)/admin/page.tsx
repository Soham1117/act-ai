import Image from "next/image";
import { db } from "@/lib/db";
import {
  dashboardData,
  dashboardExtras,
  dashboardFailures,
  openShiftSnapshot,
  STALE_SHIFT_HOURS,
  safe,
} from "@/server/queries/dashboard";
import { loadHoursWidgetPack } from "@/server/queries/hours-widgets";
import { formatHours } from "@/lib/format";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  AlarmClock,
  Banknote,
  Briefcase,
  Building2,
  CalendarRange,
  AlertTriangle,
  Clock,
  GitBranch,
  Plane,
  Receipt,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { getAvatarUrl } from "@/lib/format";
import { formatDistanceToNow } from "date-fns";
import {
  ApprovalsAgingChart,
  CategoryBar,
  ClockedVsScheduledChart,
  DeptUtilizationChart,
  DonutChart,
  HeadcountGrowthChart,
  HoursByDeptChart,
  HoursTrendChart,
  LeaveHeatmap,
  OvertimeRiskChart,
  PayrollTrendChart,
  RadarSpiderChart,
  RequestsFunnel,
} from "@/components/charts/dashboard-charts";

export const metadata = { title: "Admin home" };

export default async function AdminHomePage() {
  const [
    activeEmployees,
    openShifts,
    pendingApprovals,
    departments,
    charts,
    extras,
    widgets,
  ] = await Promise.all([
    safe(db.employee.count({ where: { employmentStatus: "ACTIVE" } }), 0, "active employees"),
    openShiftSnapshot(),
    safe(db.timeEntry.count({ where: { approvalStatus: "PENDING", clockOut: { not: null } } }), 0, "pending approvals"),
    safe(db.department.count(), 0, "departments"),
    dashboardData(),
    dashboardExtras(),
    safe(
      loadHoursWidgetPack(),
      {
        pendingTimeApprovals: 0,
        pendingLeave: 0,
        pendingRequests: 0,
        staleOpen: 0,
        birthdays: [],
        pendingTimeOff: [],
        approachingOt: [],
        conflictingSegments: 0,
        recentOt: [],
      },
      "hours widgets",
    ),
  ]);
  const clockedIn = openShifts.live.size;
  const staleOpen = openShifts.stale.size;
  // Read after all queries settled: any swallowed failure is listed here.
  const failures = dashboardFailures();

  const headcountDonut = charts.headcountByDept.map((d) => ({
    department: d.department,
    count: d.count,
  }));
  const leaveTypesDonut = charts.leaveTypes.map((l) => ({
    type: l.type.replace(/_/g, " "),
    count: l.count,
  }));

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden">
      {failures.length > 0 && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Some data failed to load</div>
            <div className="text-xs opacity-90">
              Numbers and charts below may be incomplete (zeros can mean &quot;failed&quot;, not &quot;none&quot;).
              Reload the page; if it persists check the server logs.
            </div>
          </div>
        </div>
      )}
      {staleOpen > 0 && (
        <Link
          href="/admin/time-tracking"
          className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 hover:bg-amber-500/15 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">
              {staleOpen} open shift{staleOpen === 1 ? "" : "s"} need attention
            </div>
            <div className="text-xs opacity-90">
              Clocked in for more than {STALE_SHIFT_HOURS} hours (likely a missed clock-out). Not counted as
              &quot;Clocked in now&quot;. Review in Time tracking.
            </div>
          </div>
        </Link>
      )}
      {/* Welcome + KPI tiles in a single row on wide screens. */}
      <div className="mb-6 grid min-w-0 items-end gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)]">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight leading-tight">Welcome back</h1>
          <p className="text-xs text-muted-foreground leading-tight">
            Real-time pulse on the workforce.
          </p>
        </div>
        <div className="grid min-w-0 gap-3 grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Active employees", value: activeEmployees, icon: <Users className="h-4 w-4" /> },
            { label: "Clocked in now",   value: clockedIn,       icon: <Clock className="h-4 w-4 text-primary" /> },
            { label: "Pending approval", value: pendingApprovals, icon: <Activity className="h-4 w-4" /> },
            { label: "Departments",      value: departments,     icon: <Building2 className="h-4 w-4" /> },
          ].map((s) => (
            <div key={s.label} className="min-w-0 overflow-hidden rounded-lg border bg-card px-3 py-2.5 sm:px-4">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate uppercase tracking-wider">{s.label}</span>
                <span className="shrink-0 opacity-60">{s.icon}</span>
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums leading-tight">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* TCP-parity manager widgets */}
      <div className="mb-6 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Required approvals ({widgets.pendingTimeApprovals + widgets.pendingLeave + widgets.pendingRequests})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            <Link href="/admin/time-tracking?tab=pending" className="block hover:underline">
              Time · {widgets.pendingTimeApprovals}
            </Link>
            <Link href="/admin/leave" className="block hover:underline">
              Leave · {widgets.pendingLeave}
            </Link>
            <Link href="/admin/requests" className="block hover:underline">
              Requests · {widgets.pendingRequests}
            </Link>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Missed punches ({widgets.staleOpen})</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link href="/admin/time-tracking?tab=attention" className="hover:underline">
              Open shifts over {STALE_SHIFT_HOURS}h — review
            </Link>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Birthdays ({widgets.birthdays.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {widgets.birthdays.length === 0 ? (
              <p className="text-muted-foreground">None in the next 14 days.</p>
            ) : (
              widgets.birthdays.map((b) => (
                <div key={b.id} className="flex justify-between gap-2">
                  <span className="truncate">{b.name}</span>
                  <span className="shrink-0 text-muted-foreground">{b.dateLabel}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Pending time off ({widgets.pendingTimeOff.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {widgets.pendingTimeOff.length === 0 ? (
              <p className="text-muted-foreground">None pending.</p>
            ) : (
              widgets.pendingTimeOff.slice(0, 4).map((l) => (
                <Link key={l.id} href="/admin/leave" className="block hover:underline">
                  <span className="font-medium">{l.name}</span>{" "}
                  <span className="text-muted-foreground">
                    {l.type} · {l.start}
                  </span>
                </Link>
              ))
            )}
            <Link href="/admin/leave" className="text-muted-foreground hover:underline">
              Jump to leave
            </Link>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Approaching OT ({widgets.approachingOt.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {widgets.approachingOt.length === 0 ? (
              <p className="text-muted-foreground">Nobody between 35h and 40h this week.</p>
            ) : (
              widgets.approachingOt.slice(0, 5).map((a) => (
                <Link
                  key={a.id}
                  href={`/admin/hours?employee=${a.id}`}
                  className="flex justify-between gap-2 hover:underline"
                >
                  <span className="truncate">
                    {a.name}
                    {a.open ? " · in" : ""}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">{formatHours(a.weekMin)}</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Conflicting segments ({widgets.conflictingSegments})
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link href="/admin/hours" className="hover:underline">
              Overlapping punches in the last 14 days
            </Link>
          </CardContent>
        </Card>
        <Card className="min-w-0 sm:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Overtime this week ({widgets.recentOt.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {widgets.recentOt.length === 0 ? (
              <p className="text-muted-foreground">No OT past 40h yet this week.</p>
            ) : (
              widgets.recentOt.map((o) => (
                <div key={`${o.name}-${o.date}`} className="flex justify-between gap-2">
                  <span className="truncate">{o.name}</span>
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                    +{formatHours(o.minutes)}
                  </span>
                </div>
              ))
            )}
            <Link href="/admin/reports/period" className="text-muted-foreground hover:underline">
              Period reports
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Top charts row */}
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="space-y-1">
            <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
              <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">Hours by department · last 4 weeks</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <HoursByDeptChart data={charts.byDept} />
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="space-y-1">
            <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
              <Activity className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">Hours trend · last 12 weeks</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <HoursTrendChart data={charts.trend} />
          </CardContent>
        </Card>
      </div>

      {/* 3-column charts row */}
      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-3">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">Department headcount</span>
            </CardTitle>
            <CardDescription>Active employees only.</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <RadarSpiderChart data={headcountDonut} nameKey="department" valueKey="count" />
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
              <Plane className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">Leave types · this year</span>
            </CardTitle>
            <CardDescription>Approved + pending.</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <DonutChart data={leaveTypesDonut} nameKey="type" valueKey="count" paletteOffset={2} />
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
              <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">Reimbursements · 12 mo</span>
            </CardTitle>
            <CardDescription>Total $ spent per category.</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <CategoryBar data={charts.reimbCats.slice(0, 8)} labelKey="category" valueKey="total" />
          </CardContent>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-2">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Top employees this week</CardTitle>
            <CardDescription>Hours logged this ISO week.</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            {charts.topEmployees.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No hours yet this week.</p>
            ) : (
              <ul className="space-y-2.5">
                {charts.topEmployees.map((e, i) => (
                  <li key={e.id} className="flex min-w-0 items-center gap-3">
                    <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full bg-muted">
                      <Image src={e.profilePic ?? getAvatarUrl(e.email)} alt={e.name} fill sizes="28px" className="object-cover" unoptimized />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{e.name}</span>
                    <span className="shrink-0 font-mono text-sm tabular-nums">{e.hours}h</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Latest activity</CardTitle>
            <CardDescription>From the audit log.</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            {charts.activity.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No activity recorded yet.</p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {charts.activity.map((a) => (
                  <li key={a.id} className="flex min-w-0 items-start gap-2 text-xs">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    <span className="min-w-0 flex-1 break-words">
                      <span className="font-medium">{a.actorEmail ?? "system"}</span>
                      <span className="text-muted-foreground"> · {a.action}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(a.createdAt, { addSuffix: true })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Full-width growth chart */}
      <Card className="mt-6 min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Headcount growth · 6 years</CardTitle>
          <CardDescription>Cumulative active hires by month.</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 overflow-hidden">
          <HeadcountGrowthChart data={charts.growth} />
        </CardContent>
      </Card>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* New analytics — appended below for evaluation                */}
      {/* ─────────────────────────────────────────────────────────── */}

      <div className="mt-10 mb-3 flex items-center gap-2">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          New analytics
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Live ops row: clocked vs scheduled + approvals aging */}
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
              <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">Live coverage</span>
            </CardTitle>
            <CardDescription>
              Clocked in vs people scheduled to be working right now.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <ClockedVsScheduledChart data={extras.clocked} />
            {extras.clocked.staleOpen > 0 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                {extras.clocked.staleOpen} stale open shift(s) excluded —{" "}
                <Link href="/admin/time-tracking" className="underline">
                  needs attention
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
              <AlarmClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">Pending approvals · aging</span>
            </CardTitle>
            <CardDescription>
              Timesheets, leave, requests &amp; reimbursements bucketed by age.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <ApprovalsAgingChart data={extras.aging} />
          </CardContent>
        </Card>
      </div>

      {/* Workforce row: dept utilization + overtime risk */}
      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-2">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">Department utilization · last 7 days</span>
            </CardTitle>
            <CardDescription>
              Worked vs scheduled hours per department, with utilization %.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <DeptUtilizationChart data={extras.deptUtil} />
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
              <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">Overtime risk · this week</span>
            </CardTitle>
            <CardDescription>
              Top 8 employees by hours. Red bars are over the 40h line.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <OvertimeRiskChart data={extras.overtime} />
          </CardContent>
        </Card>
      </div>

      {/* Money + planning row: payroll trend + leave heatmap */}
      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-2">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
              <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">Payroll cost trend · last 6 periods</span>
            </CardTitle>
            <CardDescription>
              Estimated cost from worked hours × rate, per pay period.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <PayrollTrendChart data={extras.payroll} />
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
              <CalendarRange className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">Leave coverage · next 30 days</span>
            </CardTitle>
            <CardDescription>
              How many people are on approved leave each day.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <LeaveHeatmap data={extras.leaveHeat} />
          </CardContent>
        </Card>
      </div>

      {/* Funnel row */}
      <Card className="mt-6 min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex min-w-0 items-start gap-2 text-base leading-snug">
            <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0">Requests funnel · last 90 days</span>
          </CardTitle>
          <CardDescription>
            Volume by request type, segmented by outcome, with median time-to-decision.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 overflow-hidden">
          <RequestsFunnel data={extras.funnel} />
        </CardContent>
      </Card>
    </div>
  );
}
