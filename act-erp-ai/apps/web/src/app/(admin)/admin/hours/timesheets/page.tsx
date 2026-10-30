import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { HoursSubnav } from "@/components/hours-subnav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateOnly, formatHours } from "@/lib/format";
import { dateOnlyToString } from "@/lib/time-rules";
import { allocateWeeklyOvertime } from "@/lib/payroll-overtime";
import { loadHoursPeriodPresets, resolveHoursRange } from "@/lib/hours-period";

export const metadata = { title: "Time sheets" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function TimeSheetsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = resolveHoursRange(one(sp.from), one(sp.to));
  const [presets, employees, entries] = await Promise.all([
    loadHoursPeriodPresets(),
    db.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, employeeId: true, exportCode: true },
    }),
    db.timeEntry.findMany({
      where: {
        date: { gte: from, lte: to },
        approvalStatus: { not: "REJECTED" },
      },
      select: {
        employeeId: true,
        date: true,
        clockIn: true,
        totalWorkMin: true,
      },
    }),
  ]);

  const byEmp = new Map<string, typeof entries>();
  for (const e of entries) {
    const arr = byEmp.get(e.employeeId) ?? [];
    arr.push(e);
    byEmp.set(e.employeeId, arr);
  }

  const sheets = employees
    .map((emp) => {
      const list = byEmp.get(emp.id) ?? [];
      if (!list.length) return null;
      const ot = allocateWeeklyOvertime(
        list.map((e) => ({
          date: dateOnlyToString(e.date),
          clockIn: e.clockIn.getTime(),
          minutes: e.totalWorkMin,
        })),
        fromStr,
        toStr,
      );
      return {
        emp,
        days: list.length,
        regularMin: ot.regularMin,
        otMin: ot.overtimeMin,
        totalMin: ot.regularMin + ot.overtimeMin,
      };
    })
    .filter(Boolean);

  return (
    <>
      <PageHeader
        title="Time sheets"
        description="Period pack of employee hours (regular / OT). Print this page or open Individual for punch detail."
      />
      <HoursSubnav />

      <Card className="mb-4 print:hidden">
        <CardContent className="flex flex-wrap gap-2 p-4">
          {presets.map((p) => (
            <Button key={p.id} asChild size="sm" variant="outline">
              <Link href={`/admin/hours/timesheets?from=${p.from}&to=${p.to}`}>{p.label}</Link>
            </Button>
          ))}
          <Button asChild size="sm">
            <Link href={`/admin/hours/period-export?from=${fromStr}&to=${toStr}`}>
              Export CSV
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Time sheets · {formatDateOnly(from)} – {formatDateOnly(to)}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Employee</th>
                <th className="px-3 py-2 text-right font-medium">Days</th>
                <th className="px-3 py-2 text-right font-medium">Regular</th>
                <th className="px-3 py-2 text-right font-medium">OT</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 print:hidden"> </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sheets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No hours in this range.
                  </td>
                </tr>
              ) : (
                sheets.map((s) =>
                  s ? (
                    <tr key={s.emp.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{s.emp.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {s.emp.exportCode ?? s.emp.employeeId}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{s.days}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatHours(s.regularMin)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatHours(s.otMin)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatHours(s.totalMin)}
                      </td>
                      <td className="px-3 py-2 print:hidden">
                        <Link
                          href={`/admin/hours?employee=${s.emp.id}&from=${fromStr}&to=${toStr}`}
                          className="text-xs underline"
                        >
                          Detail
                        </Link>
                      </td>
                    </tr>
                  ) : null,
                )
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
