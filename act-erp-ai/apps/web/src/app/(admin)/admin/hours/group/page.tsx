import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { HoursSubnav } from "@/components/hours-subnav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterStack } from "@/components/mobile";
import { formatDateOnly, formatHours } from "@/lib/format";
import { addDaysDateOnly, dateOnlyToString } from "@/lib/time-rules";
import { loadHoursPeriodPresets, resolveHoursRange } from "@/lib/hours-period";
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

      <Card className="mb-4">
        <CardContent className="space-y-3 p-4">
          <form method="get" action="/admin/hours/group">
            <FilterStack className="items-end">
              <div className="w-full space-y-1 sm:w-auto">
                <label className="text-xs text-muted-foreground" htmlFor="gh-from">
                  From
                </label>
                <Input id="gh-from" type="date" name="from" defaultValue={fromStr} className="h-9 w-full sm:w-40" />
              </div>
              <div className="w-full space-y-1 sm:w-auto">
                <label className="text-xs text-muted-foreground" htmlFor="gh-to">
                  To
                </label>
                <Input id="gh-to" type="date" name="to" defaultValue={toStr} className="h-9 w-full sm:w-40" />
              </div>
              <div className="w-full space-y-1 sm:w-48">
                <label className="text-xs text-muted-foreground" htmlFor="gh-dept">
                  Department
                </label>
                <select
                  id="gh-dept"
                  name="dept"
                  defaultValue={deptId}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">All</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm">
                Update
              </Button>
            </FilterStack>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <Button key={p.id} asChild size="sm" variant="outline" className="h-8 text-xs">
                <Link
                  href={`/admin/hours/group?from=${p.from}&to=${p.to}${deptId ? `&dept=${deptId}` : ""}`}
                >
                  {p.label}
                </Link>
              </Button>
            ))}
          </div>
          {allPending.length > 0 ? <GroupHoursApproveBar ids={allPending} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {formatDateOnly(from)} – {formatDateOnly(to)} ({employees.length} employees)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 font-medium">Employee</th>
                  {days.map((d) => (
                    <th key={d} className="px-2 py-2 text-center font-medium whitespace-nowrap">
                      {d.slice(5)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {employees.map((emp) => {
                  let rowMin = 0;
                  return (
                    <tr key={emp.id}>
                      <td className="sticky left-0 z-10 bg-background px-3 py-2">
                        <Link
                          href={`/admin/hours?employee=${emp.id}&from=${fromStr}&to=${toStr}`}
                          className="font-medium hover:underline"
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
                            className={`px-2 py-2 text-center font-mono tabular-nums ${
                              c?.pendingIds.length ? "bg-amber-500/10" : ""
                            }`}
                          >
                            {m > 0 ? formatHours(m) : "·"}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatHours(rowMin)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {dayCount > 31 ? (
            <p className="border-t p-3 text-[11px] text-muted-foreground">
              Showing first 31 days of the range. Narrow the dates for a full matrix.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
