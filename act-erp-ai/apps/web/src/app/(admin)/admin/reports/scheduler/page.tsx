import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateOnly, formatHours } from "@/lib/format";
import { dateOnlyToString } from "@/lib/time-rules";
import { loadHoursPeriodPresets, resolveHoursRange } from "@/lib/hours-period";

export const metadata = { title: "Scheduler reports" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SchedulerReportsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = resolveHoursRange(one(sp.from), one(sp.to));

  const [presets, scheduled, actual] = await Promise.all([
    loadHoursPeriodPresets(),
    db.scheduledWork.findMany({
      where: { date: { gte: from, lte: to } },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        employeeId: true,
        employee: { select: { name: true } },
      },
    }),
    db.timeEntry.findMany({
      where: {
        date: { gte: from, lte: to },
        approvalStatus: { not: "REJECTED" },
      },
      select: {
        employeeId: true,
        date: true,
        totalWorkMin: true,
      },
    }),
  ]);

  const scheduledMinByEmpDay = new Map<string, number>();
  for (const s of scheduled) {
    const key = `${s.employeeId}|${dateOnlyToString(s.date)}`;
    const mins = Math.max(
      0,
      Math.round((s.endTime.getTime() - s.startTime.getTime()) / 60_000),
    );
    scheduledMinByEmpDay.set(key, (scheduledMinByEmpDay.get(key) ?? 0) + mins);
  }

  const actualMinByEmpDay = new Map<string, number>();
  for (const a of actual) {
    const key = `${a.employeeId}|${dateOnlyToString(a.date)}`;
    actualMinByEmpDay.set(key, (actualMinByEmpDay.get(key) ?? 0) + a.totalWorkMin);
  }

  let scheduledTotal = 0;
  let actualTotal = 0;
  let varianceAbs = 0;
  const keys = new Set([...scheduledMinByEmpDay.keys(), ...actualMinByEmpDay.keys()]);
  for (const key of keys) {
    const s = scheduledMinByEmpDay.get(key) ?? 0;
    const a = actualMinByEmpDay.get(key) ?? 0;
    scheduledTotal += s;
    actualTotal += a;
    varianceAbs += Math.abs(a - s);
  }

  const unfilled = [...scheduledMinByEmpDay.entries()].filter(([key, s]) => {
    const a = actualMinByEmpDay.get(key) ?? 0;
    return s > 0 && a === 0;
  }).length;

  const byDay = new Map<string, { scheduled: number; actual: number }>();
  for (const s of scheduled) {
    const d = dateOnlyToString(s.date);
    const cur = byDay.get(d) ?? { scheduled: 0, actual: 0 };
    cur.scheduled += Math.max(
      0,
      Math.round((s.endTime.getTime() - s.startTime.getTime()) / 60_000),
    );
    byDay.set(d, cur);
  }
  for (const a of actual) {
    const d = dateOnlyToString(a.date);
    const cur = byDay.get(d) ?? { scheduled: 0, actual: 0 };
    cur.actual += a.totalWorkMin;
    byDay.set(d, cur);
  }

  return (
    <>
      <PageHeader
        title="Scheduler reports"
        description="Coverage and schedule-vs-actual for the selected range."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {presets.map((p) => (
          <Button key={p.id} asChild size="sm" variant="outline">
            <Link href={`/admin/reports/scheduler?from=${p.from}&to=${p.to}`}>{p.label}</Link>
          </Button>
        ))}
        <Button asChild size="sm" variant="secondary">
          <Link href="/admin/schedules">Open schedules</Link>
        </Button>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        {formatDateOnly(from)} – {formatDateOnly(to)}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">Scheduled hours</p>
            <p className="font-mono text-xl tabular-nums">{formatHours(scheduledTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">Actual hours</p>
            <p className="font-mono text-xl tabular-nums">{formatHours(actualTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">Abs variance</p>
            <p className="font-mono text-xl tabular-nums">{formatHours(varianceAbs)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">Unfilled shift-days</p>
            <p className="font-mono text-xl tabular-nums">{unfilled}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Coverage by day</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Scheduled</th>
                <th className="px-3 py-2 text-right">Actual</th>
                <th className="px-3 py-2 text-right">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...byDay.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([day, v]) => (
                  <tr key={day}>
                    <td className="px-3 py-2">{day}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatHours(v.scheduled)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatHours(v.actual)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatHours(v.actual - v.scheduled)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {byDay.size === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No schedule or punches in range. ({fromStr}–{toStr})
            </p>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
