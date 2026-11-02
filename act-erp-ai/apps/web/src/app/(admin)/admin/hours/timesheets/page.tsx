import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { HoursSubnav } from "@/components/hours-subnav";
import {
  HoursField,
  HoursFilterRow,
  HoursPresetChips,
  HoursToolbarCard,
  hoursRowClass,
  hoursTableClass,
  hoursTdClass,
  hoursThClass,
  hoursTheadClass,
} from "@/components/hours-ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormDateField } from "@/components/date-field";
import { formatDateOnly, formatHours } from "@/lib/format";
import { dateOnlyToString } from "@/lib/time-rules";
import { allocateWeeklyOvertime } from "@/lib/payroll-overtime";
import { loadHoursPeriodPresets, resolveHoursRange } from "@/lib/hours-period";
import { cn } from "@/lib/utils";

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

      <HoursToolbarCard className="mb-4 print:hidden">
        <form method="get" action="/admin/hours/timesheets">
          <HoursFilterRow>
            <HoursField label="From" htmlFor="ts-from">
              <FormDateField
                id="ts-from"
                name="from"
                defaultValue={fromStr}
                aria-label="From date"
              />
            </HoursField>
            <HoursField label="To" htmlFor="ts-to">
              <FormDateField id="ts-to" name="to" defaultValue={toStr} aria-label="To date" />
            </HoursField>
            <Button type="submit" size="sm" className="h-9 w-full sm:w-auto">
              Update
            </Button>
            <Button asChild size="sm" variant="secondary" className="h-9 w-full sm:w-auto">
              <Link href={`/admin/hours/period-export?from=${fromStr}&to=${toStr}`}>
                Export CSV
              </Link>
            </Button>
          </HoursFilterRow>
        </form>
        <HoursPresetChips
          presets={presets}
          activeFrom={fromStr}
          activeTo={toStr}
          hrefFor={(p) => `/admin/hours/timesheets?from=${p.from}&to=${p.to}`}
        />
      </HoursToolbarCard>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border px-4 py-3">
          <CardTitle className="text-base font-semibold">
            Time sheets
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {formatDateOnly(from)} – {formatDateOnly(to)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className={hoursTableClass}>
              <thead className={hoursTheadClass}>
                <tr>
                  <th className={hoursThClass}>Employee</th>
                  <th className={cn(hoursThClass, "text-right")}>Days</th>
                  <th className={cn(hoursThClass, "text-right")}>Regular</th>
                  <th className={cn(hoursThClass, "text-right")}>OT</th>
                  <th className={cn(hoursThClass, "text-right")}>Total</th>
                  <th className={cn(hoursThClass, "print:hidden")}>
                    <span className="sr-only">Detail</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sheets.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-10 text-center text-sm text-muted-foreground"
                    >
                      No hours in this range.
                    </td>
                  </tr>
                ) : (
                  sheets.map((s) =>
                    s ? (
                      <tr key={s.emp.id} className={hoursRowClass}>
                        <td className={hoursTdClass}>
                          <div className="font-medium leading-snug">{s.emp.name}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {s.emp.exportCode ?? s.emp.employeeId}
                          </div>
                        </td>
                        <td
                          className={cn(
                            hoursTdClass,
                            "text-right font-mono tabular-nums",
                          )}
                        >
                          {s.days}
                        </td>
                        <td
                          className={cn(
                            hoursTdClass,
                            "text-right font-mono tabular-nums",
                          )}
                        >
                          {formatHours(s.regularMin)}
                        </td>
                        <td
                          className={cn(
                            hoursTdClass,
                            "text-right font-mono tabular-nums",
                          )}
                        >
                          {formatHours(s.otMin)}
                        </td>
                        <td
                          className={cn(
                            hoursTdClass,
                            "text-right font-mono font-medium tabular-nums",
                          )}
                        >
                          {formatHours(s.totalMin)}
                        </td>
                        <td className={cn(hoursTdClass, "print:hidden")}>
                          <Link
                            href={`/admin/hours?employee=${s.emp.id}&from=${fromStr}&to=${toStr}`}
                            className="text-xs font-medium text-primary hover:underline"
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
          </div>
        </CardContent>
      </Card>
    </>
  );
}
