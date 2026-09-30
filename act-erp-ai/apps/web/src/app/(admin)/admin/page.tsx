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
  ] = await Promise.all([
    safe(db.employee.count({ where: { employmentStatus: "ACTIVE" } }), 0, "active employees"),
    openShiftSnapshot(),
    safe(db.timeEntry.count({ where: { approvalStatus: "PENDING", clockOut: { not: null } } }), 0, "pending approvals"),
    safe(db.department.count(), 0, "departments"),
    dashboardData(),
    dashboardExtras(),
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
    <>
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
      <div className="mb-6 grid items-end gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)]">
        <div>
          <h1 className="text-xl font-bold tracking-tight leading-tight">Welcome back</h1>
          <p className="text-xs text-muted-foreground leading-tight">
            Real-time pulse on the workforce.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Active employees", value: activeEmployees, icon: <Users className="h-4 w-4" /> },
            { label: "Clocked in now",   value: clockedIn,       icon: <Clock className="h-4 w-4 text-primary" /> },
            { label: "Pending approval", value: pendingApprovals, icon: <Activity className="h-4 w-4" /> },
            { label: "Departments",      value: departments,     icon: <Building2 className="h-4 w-4" /> },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border bg-card px-4 py-2.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="uppercase tracking-wider">{s.label}</span>
                <span className="opacity-60">{s.icon}</span>
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums leading-tight">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Top charts row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Briefcase className="h-4 w-4 text-primary" /> Hours by department · last 4 weeks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HoursByDeptChart data={charts.byDept} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" /> Hours trend · last 12 weeks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HoursTrendChart data={charts.trend} />
          </CardContent>
        </Card>
      </div>

      {/* 3-column charts row */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" /> Department headcount
            </CardTitle>
            <CardDescription>Active employees only.</CardDescription>
          </CardHeader>
          <CardContent>
            <RadarSpiderChart data={headcountDonut} nameKey="department" valueKey="count" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plane className="h-4 w-4 text-primary" /> Leave types · this year
            </CardTitle>
            <CardDescription>Approved + pending.</CardDescription>
          </CardHeader>
          <CardContent>
            <DonutChart data={leaveTypesDonut} nameKey="type" valueKey="count" paletteOffset={2} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4 text-primary" /> Reimbursements · 12 mo
            </CardTitle>
            <CardDescription>Total $ spent per category.</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryBar data={charts.reimbCats.slice(0, 8)} labelKey="category" valueKey="total" />
          </CardContent>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top employees this week</CardTitle>
            <CardDescription>Hours logged this ISO week.</CardDescription>
          </CardHeader>
          <CardContent>
            {charts.topEmployees.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No hours yet this week.</p>
            ) : (
              <ul className="space-y-2.5">
                {charts.topEmployees.map((e, i) => (
                  <li key={e.id} className="flex items-center gap-3">
                    <span className="w-5 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <span className="relative h-7 w-7 overflow-hidden rounded-full bg-muted">
                      <Image src={e.profilePic ?? getAvatarUrl(e.email)} alt={e.name} fill sizes="28px" className="object-cover" unoptimized />
                    </span>
                    <span className="flex-1 text-sm">{e.name}</span>
                    <span className="font-mono text-sm tabular-nums">{e.hours}h</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest activity</CardTitle>
            <CardDescription>From the audit log.</CardDescription>
          </CardHeader>
          <CardContent>
            {charts.activity.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No activity recorded yet.</p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {charts.activity.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-xs">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    <span className="flex-1">
                      <span className="font-medium">{a.actorEmail ?? "system"}</span>
                      <span className="text-muted-foreground"> · {a.action}</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
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
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Headcount growth · 6 years</CardTitle>
          <CardDescription>Cumulative active hires by month.</CardDescription>
        </CardHeader>
        <CardContent>
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
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-primary" /> Live coverage
            </CardTitle>
            <CardDescription>
              Clocked in vs people scheduled to be working right now.
            </CardDescription>
          </CardHeader>
          <CardContent>
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlarmClock className="h-4 w-4 text-primary" /> Pending approvals · aging
            </CardTitle>
            <CardDescription>
              Timesheets, leave, requests &amp; reimbursements bucketed by age.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApprovalsAgingChart data={extras.aging} />
          </CardContent>
        </Card>
      </div>

      {/* Workforce row: dept utilization + overtime risk */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" /> Department utilization · last 7 days
            </CardTitle>
            <CardDescription>
              Worked vs scheduled hours per department, with utilization %.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeptUtilizationChart data={extras.deptUtil} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" /> Overtime risk · this week
            </CardTitle>
            <CardDescription>
              Top 8 employees by hours. Red bars are over the 40h line.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OvertimeRiskChart data={extras.overtime} />
          </CardContent>
        </Card>
      </div>

      {/* Money + planning row: payroll trend + leave heatmap */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-4 w-4 text-primary" /> Payroll cost trend · last 6 periods
            </CardTitle>
            <CardDescription>
              Estimated cost from worked hours × rate, per pay period.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PayrollTrendChart data={extras.payroll} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange className="h-4 w-4 text-primary" /> Leave coverage · next 30 days
            </CardTitle>
            <CardDescription>
              How many people are on approved leave each day.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LeaveHeatmap data={extras.leaveHeat} />
          </CardContent>
        </Card>
      </div>

      {/* Funnel row */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-primary" /> Requests funnel · last 90 days
          </CardTitle>
          <CardDescription>
            Volume by request type, segmented by outcome, with median time-to-decision.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RequestsFunnel data={extras.funnel} />
        </CardContent>
      </Card>
    </>
  );
}
