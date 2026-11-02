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
import { FormSimpleSelect } from "@/components/simple-select";
import { formatDateOnly, formatHours } from "@/lib/format";
import { addDaysDateOnly, dateOnlyToString } from "@/lib/time-rules";
import { loadHoursPeriodPresets, resolveHoursRange } from "@/lib/hours-period";
import { cn } from "@/lib/utils";
import { GroupHoursApproveBar } from "./group-hours-client";

export const metadata = { title: "Group hours" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function GroupHoursPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = resolveHoursRange(one(sp.from), one(sp.to));
  const deptId = one(sp.dept).trim();

  const dayCount =
    Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const days: string[] = [];
  for (let i = 0; i < Math.min(dayCount, 31); i++) {
    days.push(dateOnlyToString(addDaysDateOnly(from, i)));
  }

  const [presets, departments, employees, entries] = await Promise.all([
    loadHoursPeriodPresets(),
    db.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.employee.findMany({
      where: {
        employmentStatus: "ACTIVE",
        ...(deptId ? { departmentId: deptId } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, employeeId: true, exportCode: true, departmentId: true },
    }),
    db.timeEntry.findMany({
      where: {
        date: { gte: from, lte: to },
        approvalStatus: { not: "REJECTED" },
        ...(deptId ? { employee: { departmentId: deptId } } : {}),
      },
      select: {
        id: true,
        employeeId: true,
        date: true,
        totalWorkMin: true,
        approvalStatus: true,
        status: true,
      },
    }),
  ]);

  const cell = new Map<string, { minutes: number; pendingIds: string[] }>();
  for (const e of entries) {
    const key = `${e.employeeId}|${dateOnlyToString(e.date)}`;
    const cur = cell.get(key) ?? { minutes: 0, pendingIds: [] };
    cur.minutes += e.totalWorkMin;
    if (e.approvalStatus === "PENDING" && e.status === "COMPLETED") cur.pendingIds.push(e.id);
    cell.set(key, cur);
  }

  const allPending = entries
    .filter((e) => e.approvalStatus === "PENDING" && e.status === "COMPLETED")
    .map((e) => e.id);

  return (
    <>
      <PageHeader
        title="Group hours"
        description="Hours matrix by employee and day. Drill into Individual for punch detail."
      />
      <HoursSubnav />

      <HoursToolbarCard className="mb-4">
        <form method="get" action="/admin/hours/group">
          <HoursFilterRow>
            <HoursField label="From" htmlFor="gh-from">
              <FormDateField
                id="gh-from"
                name="from"
                defaultValue={fromStr}
                aria-label="From date"
              />
            </HoursField>
            <HoursField label="To" htmlFor="gh-to">
              <FormDateField id="gh-to" name="to" defaultValue={toStr} aria-label="To date" />
            </HoursField>
            <HoursField label="Department" htmlFor="gh-dept" className="sm:w-48">
              <FormSimpleSelect
                id="gh-dept"
                name="dept"
                defaultValue={deptId}
                placeholder="All"
                triggerClassName="h-9"
                options={[
                  { value: "", label: "All" },
                  ...departments.map((d) => ({ value: d.id, label: d.name })),
                ]}
              />
            </HoursField>
            <Button type="submit" size="sm" className="h-9 w-full sm:w-auto">
              Update
            </Button>
          </HoursFilterRow>
        </form>
        <HoursPresetChips
          presets={presets}
          activeFrom={fromStr}
          activeTo={toStr}
          hrefFor={(p) =>
            `/admin/hours/group?from=${p.from}&to=${p.to}${deptId ? `&dept=${deptId}` : ""}`
          }
        />
        {allPending.length > 0 ? <GroupHoursApproveBar ids={allPending} /> : null}
      </HoursToolbarCard>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border px-4 py-3">
          <CardTitle className="text-base font-semibold">
            {formatDateOnly(from)} – {formatDateOnly(to)}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {employees.length} employees
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className={cn(hoursTableClass, "min-w-[640px] text-xs")}>
              <thead className={hoursTheadClass}>
                <tr>
                  <th
                    className={cn(
                      hoursThClass,
                      "sticky left-0 z-10 bg-muted/50 min-w-[10rem]",
                    )}
                  >
                    Employee
                  </th>
                  {days.map((d) => (
                    <th
                      key={d}
                      className={cn(hoursThClass, "px-2 text-center whitespace-nowrap")}
                    >
                      {d.slice(5)}
                    </th>
                  ))}
                  <th className={cn(hoursThClass, "text-right")}>Total</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  let rowMin = 0;
                  return (
                    <tr key={emp.id} className={hoursRowClass}>
                      <td
                        className={cn(
                          hoursTdClass,
                          "sticky left-0 z-10 bg-card font-medium",
                        )}
                      >
                        <Link
                          href={`/admin/hours?employee=${emp.id}&from=${fromStr}&to=${toStr}`}
                          className="hover:underline"
                        >
                          {emp.name}
                        </Link>
                      </td>
                      {days.map((d) => {
                        const c = cell.get(`${emp.id}|${d}`);
                        const m = c?.minutes ?? 0;
                        rowMin += m;
                        return (
                          <td
                            key={d}
                            className={cn(
                              hoursTdClass,
                              "px-2 text-center font-mono tabular-nums",
                              c?.pendingIds.length ? "bg-amber-500/10" : "",
                            )}
                          >
                            {m > 0 ? formatHours(m) : "–"}
                          </td>
                        );
                      })}
                      <td
                        className={cn(
                          hoursTdClass,
                          "text-right font-mono font-medium tabular-nums",
                        )}
                      >
                        {formatHours(rowMin)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {dayCount > 31 ? (
            <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              Showing first 31 days of the range. Narrow the dates for a full matrix.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
