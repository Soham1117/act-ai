import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateOnly, formatHours } from "@/lib/format";
import { dateOnlyToString } from "@/lib/time-rules";
import { allocateWeeklyOvertime } from "@/lib/payroll-overtime";
import { loadHoursPeriodPresets, resolveHoursRange } from "@/lib/hours-period";

export const metadata = { title: "Period reports" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PeriodReportsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = resolveHoursRange(one(sp.from), one(sp.to));
  const [presets, entries, openPending, autoClosed] = await Promise.all([
    loadHoursPeriodPresets(),
    db.timeEntry.findMany({
      where: { date: { gte: from, lte: to } },
      select: {
        id: true,
        employeeId: true,
        date: true,
        clockIn: true,
        totalWorkMin: true,
        jobCode: true,
        approvalStatus: true,
        status: true,
        autoClosed: true,
        employee: {
          select: {
            name: true,
            department: { select: { name: true } },
          },
        },
      },
    }),
    db.timeEntry.count({
      where: {
        date: { gte: from, lte: to },
        approvalStatus: "PENDING",
        clockOut: { not: null },
      },
    }),
    db.timeEntry.count({
      where: { date: { gte: from, lte: to }, autoClosed: true },
    }),
  ]);

  const byDept = new Map<string, number>();
  const byJob = new Map<string, number>();
  const byEmp = new Map<string, { name: string; minutes: number; entries: typeof entries }>();

  for (const e of entries) {
    if (e.approvalStatus === "REJECTED") continue;
    const dept = e.employee.department?.name ?? "Unassigned";
    byDept.set(dept, (byDept.get(dept) ?? 0) + e.totalWorkMin);
    byJob.set(e.jobCode, (byJob.get(e.jobCode) ?? 0) + e.totalWorkMin);
    const cur = byEmp.get(e.employeeId) ?? {
      name: e.employee.name,
      minutes: 0,
      entries: [],
    };
    cur.minutes += e.totalWorkMin;
    cur.entries.push(e);
    byEmp.set(e.employeeId, cur);
  }

  let otMin = 0;
  let regMin = 0;
  for (const row of byEmp.values()) {
    const alloc = allocateWeeklyOvertime(
      row.entries.map((e) => ({
        date: dateOnlyToString(e.date),
        clockIn: e.clockIn.getTime(),
        minutes: e.totalWorkMin,
      })),
      fromStr,
      toStr,
    );
    otMin += alloc.overtimeMin;
    regMin += alloc.regularMin;
  }

  const openCount = entries.filter((e) => e.status === "ACTIVE" || e.status === "ON_BREAK").length;

  return (
    <>
      <PageHeader
        title="Period reports"
        description="Hours, OT, and exceptions for a date range. Export via Period export."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {presets.map((p) => (
          <Button key={p.id} asChild size="sm" variant="outline">
            <Link href={`/admin/reports/period?from=${p.from}&to=${p.to}`}>{p.label}</Link>
          </Button>
        ))}
        <Button asChild size="sm">
          <Link href={`/admin/hours/period-export?from=${fromStr}&to=${toStr}`}>
            Open period export
          </Link>
        </Button>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        {formatDateOnly(from)} – {formatDateOnly(to)}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">Regular hours</p>
            <p className="font-mono text-xl tabular-nums">{formatHours(regMin)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">OT hours</p>
            <p className="font-mono text-xl tabular-nums">{formatHours(otMin)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">Pending approvals</p>
            <p className="font-mono text-xl tabular-nums">{openPending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">Exceptions</p>
            <p className="font-mono text-xl tabular-nums">
              {openCount + autoClosed}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {openCount} open · {autoClosed} auto-closed
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hours by department</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {[...byDept.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, min]) => (
                  <li key={name} className="flex justify-between gap-3 border-b py-1.5">
                    <span>{name}</span>
                    <span className="font-mono tabular-nums">{formatHours(min)}</span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hours by job code</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {[...byJob.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([code, min]) => (
                  <li key={code} className="flex justify-between gap-3 border-b py-1.5">
                    <span className="font-mono">{code}</span>
                    <span className="font-mono tabular-nums">{formatHours(min)}</span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
