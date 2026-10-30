import Image from "next/image";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { HoursSubnav } from "@/components/hours-subnav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterStack } from "@/components/mobile";
import { formatBusinessTime, formatDateOnly, formatHours, getAvatarUrl } from "@/lib/format";
import { dateOnlyToString } from "@/lib/time-rules";
import { allocateWeeklyOvertime } from "@/lib/payroll-overtime";
import { loadHoursPeriodPresets, resolveHoursRange } from "@/lib/hours-period";
import { EntryActions, ManualEntryButton } from "../time-tracking/time-tools";
import type { EntryRowData } from "../time-tracking/time-types";
import { cn } from "@/lib/utils";

export const metadata = { title: "Individual hours" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const entryInclude = {
  breaks: { orderBy: { startTime: "asc" as const } },
  employee: {
    select: {
      name: true,
      employeeId: true,
      profilePic: true,
      email: true,
      defaultHourlyRate: true,
      exportCode: true,
      department: { select: { name: true } },
    },
  },
} satisfies Prisma.TimeEntryInclude;

type EntryWithRels = Prisma.TimeEntryGetPayload<{ include: typeof entryInclude }>;

function toRow(e: EntryWithRels): EntryRowData {
  return {
    id: e.id,
    employeeId: e.employeeId,
    employeeName: e.employee.name,
    employeeCode: e.employee.employeeId,
    avatar: e.employee.profilePic ?? getAvatarUrl(e.employee.email),
    date: dateOnlyToString(e.date),
    clockIn: e.clockIn.toISOString(),
    clockOut: e.clockOut?.toISOString() ?? null,
    jobCode: e.jobCode,
    rate:
      e.rate != null
        ? Number(e.rate.toString())
        : Number(e.employee.defaultHourlyRate?.toString() ?? 25),
    notes: e.timesheetNotes,
    status: e.status,
    approvalStatus: e.approvalStatus,
    approvalNotes: e.approvalNotes,
    editReason: e.editReason,
    autoClosed: e.autoClosed,
    source: e.source,
    kioskLabel: e.kioskLabel,
    hasClockInPhoto: !!e.clockInPhotoKey,
    hasClockOutPhoto: !!e.clockOutPhotoKey,
    totalWorkMin: e.totalWorkMin,
    totalBreakMin: e.totalBreakMin,
    breaks: e.breaks.map((b) => ({
      id: b.id,
      start: b.startTime.toISOString(),
      end: b.endTime?.toISOString() ?? null,
    })),
  };
}

export default async function IndividualHoursPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = resolveHoursRange(one(sp.from), one(sp.to));
  const employeeId = one(sp.employee).trim();
  const q = one(sp.q).trim();

  const [presets, employees, jobCodes, entries] = await Promise.all([
    loadHoursPeriodPresets(),
    db.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        employeeId: true,
        exportCode: true,
        profilePic: true,
        email: true,
      },
    }),
    db.jobCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, title: true },
    }),
    db.timeEntry.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(employeeId ? { employeeId } : {}),
        ...(q && !employeeId
          ? {
              employee: {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { employeeId: { contains: q, mode: "insensitive" } },
                  { exportCode: { contains: q, mode: "insensitive" } },
                ],
              },
            }
          : {}),
      },
      orderBy: [{ date: "asc" }, { clockIn: "asc" }],
      include: entryInclude,
      take: 500,
    }),
  ]);

  const rows = entries.map(toRow);
  const selected = employeeId ? employees.find((e) => e.id === employeeId) : null;

  const ot = allocateWeeklyOvertime(
    entries
      .filter((e) => e.approvalStatus !== "REJECTED" && e.totalWorkMin > 0)
      .map((e) => ({
        date: dateOnlyToString(e.date),
        clockIn: e.clockIn.getTime(),
        minutes: e.totalWorkMin,
      })),
    fromStr,
    toStr,
  );

  const href = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ from: fromStr, to: toStr, ...extra });
    return `/admin/hours?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Individual hours"
        description="Punch-level hours with rates and weekly OT. All times are Central."
        actions={
          <ManualEntryButton
            employees={employees.map((e) => ({
              id: e.id,
              name: e.name,
              employeeId: e.employeeId,
            }))}
            jobCodes={jobCodes}
          />
        }
      />
      <HoursSubnav />

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-16">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Employees</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-0">
            <form method="get" action="/admin/hours">
              <input type="hidden" name="from" value={fromStr} />
              <input type="hidden" name="to" value={toStr} />
              <Input
                name="q"
                defaultValue={q}
                placeholder="Search"
                className="mb-2 h-9"
                aria-label="Search employees"
              />
              <Button type="submit" size="sm" variant="secondary" className="mb-2 w-full">
                Search
              </Button>
            </form>
            <Link
              href={href({})}
              className={cn(
                "block rounded-md px-2 py-1.5 text-sm",
                !employeeId ? "bg-sidebar-accent font-medium" : "hover:bg-muted",
              )}
            >
              All employees
            </Link>
            <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
              {employees
                .filter(
                  (e) =>
                    !q ||
                    e.name.toLowerCase().includes(q.toLowerCase()) ||
                    e.employeeId.toLowerCase().includes(q.toLowerCase()) ||
                    (e.exportCode ?? "").toLowerCase().includes(q.toLowerCase()),
                )
                .map((e) => (
                  <li key={e.id}>
                    <Link
                      href={href({ employee: e.id })}
                      className={cn(
                        "block rounded-md px-2 py-1.5 text-sm",
                        employeeId === e.id
                          ? "bg-sidebar-accent font-medium"
                          : "hover:bg-muted",
                      )}
                    >
                      <span className="block truncate">{e.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {e.exportCode ?? e.employeeId}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <form method="get" action="/admin/hours">
                {employeeId ? <input type="hidden" name="employee" value={employeeId} /> : null}
                <FilterStack className="items-end">
                  <div className="w-full space-y-1 sm:w-auto">
                    <label className="text-xs text-muted-foreground" htmlFor="ih-from">
                      From
                    </label>
                    <Input
                      id="ih-from"
                      type="date"
                      name="from"
                      defaultValue={fromStr}
                      className="h-9 w-full sm:w-40"
                    />
                  </div>
                  <div className="w-full space-y-1 sm:w-auto">
                    <label className="text-xs text-muted-foreground" htmlFor="ih-to">
                      To
                    </label>
                    <Input
                      id="ih-to"
                      type="date"
                      name="to"
                      defaultValue={toStr}
                      className="h-9 w-full sm:w-40"
                    />
                  </div>
                  <Button type="submit" size="sm" className="w-full sm:w-auto">
                    Update
                  </Button>
                </FilterStack>
              </form>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <Button key={p.id} asChild size="sm" variant="outline" className="h-8 text-xs">
                    <Link
                      href={`/admin/hours?from=${p.from}&to=${p.to}${employeeId ? `&employee=${employeeId}` : ""}`}
                    >
                      {p.label}
                    </Link>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground">Regular</p>
                <p className="font-mono text-lg tabular-nums">{formatHours(ot.regularMin)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground">OT1</p>
                <p className="font-mono text-lg tabular-nums">{formatHours(ot.overtimeMin)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground">Total</p>
                <p className="font-mono text-lg tabular-nums">
                  {formatHours(ot.regularMin + ot.overtimeMin)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground">Scope</p>
                <p className="truncate text-sm font-medium">
                  {selected?.name ?? "All employees"}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Entries ({formatDateOnly(from)} – {formatDateOnly(to)})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">No entries in range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Date</th>
                        {!employeeId && <th className="px-3 py-2 font-medium">Employee</th>}
                        <th className="px-3 py-2 font-medium">In</th>
                        <th className="px-3 py-2 font-medium">Out</th>
                        <th className="px-3 py-2 font-medium">Break</th>
                        <th className="px-3 py-2 font-medium">Hours</th>
                        <th className="px-3 py-2 font-medium">Job</th>
                        <th className="px-3 py-2 font-medium">Rate</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium"> </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map((e) => (
                        <tr key={e.id} className="align-top">
                          <td className="px-3 py-2 whitespace-nowrap">{formatDateOnly(e.date)}</td>
                          {!employeeId && (
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full bg-muted">
                                  <Image
                                    src={e.avatar}
                                    alt=""
                                    fill
                                    sizes="28px"
                                    className="object-cover"
                                    unoptimized
                                  />
                                </span>
                                <span className="min-w-0 truncate">{e.employeeName}</span>
                              </div>
                            </td>
                          )}
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                            {formatBusinessTime(e.clockIn)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                            {e.clockOut ? formatBusinessTime(e.clockOut) : "—"}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {formatHours(e.totalBreakMin)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs tabular-nums">
                            {formatHours(e.totalWorkMin)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{e.jobCode}</td>
                          <td className="px-3 py-2 font-mono text-xs tabular-nums">
                            {e.rate != null ? `$${e.rate.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={
                                e.approvalStatus === "APPROVED"
                                  ? "success"
                                  : e.approvalStatus === "REJECTED"
                                    ? "destructive"
                                    : "warning"
                              }
                              className="text-[10px]"
                            >
                              {e.status === "ACTIVE" || e.status === "ON_BREAK"
                                ? "Open"
                                : e.approvalStatus}
                            </Badge>
                            {e.editReason ? (
                              <span className="mt-1 block text-[10px] text-muted-foreground">
                                Edited
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <EntryActions entry={e} jobCodes={jobCodes} compact />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
