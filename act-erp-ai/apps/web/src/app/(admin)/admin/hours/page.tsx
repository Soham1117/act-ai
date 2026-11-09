import { Fragment } from "react";
import { effectiveRate } from "@/lib/time-rate";
import Image from "next/image";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { HoursSubnav } from "@/components/hours-subnav";
import {
  HoursField,
  HoursFilterRow,
  HoursPresetChips,
  HoursStat,
  HoursStatRow,
  HoursToolbarCard,
  hoursRowClass,
  hoursTableClass,
  hoursTdClass,
  hoursThClass,
  hoursTheadClass,
} from "@/components/hours-ui";
import { PanelSlotRow } from "@/components/inline-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoursPeopleList } from "@/components/hours-people-list";
import { FormDateField } from "@/components/date-field";
import { formatBusinessTime, formatDateOnly, formatHours, getAvatarUrl } from "@/lib/format";
import { dateOnlyToString } from "@/lib/time-rules";
import { allocateWeeklyOvertime } from "@/lib/payroll-overtime";
import { loadHoursPeriodPresets, resolveHoursRange } from "@/lib/hours-period";
import { EntryActions, ManualEntryButton } from "../time-tracking/time-tools";
import { entryPanelSlotId, type EntryRowData } from "../time-tracking/time-types";
import { cn } from "@/lib/utils";
import { DownloadEmployeeHoursButton } from "./download-employee-hours";

export const metadata = { title: "Employee hours" };

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
    rate: effectiveRate(e.rate, e.employee.defaultHourlyRate),
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
      where: { employmentStatus: { in: ["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED"] } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        employeeId: true,
        exportCode: true,
        tcpNumber: true,
        employmentStatus: true,
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
                  { tcpNumber: { contains: q } },
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
        title="Employee hours"
        description="Punch-level hours with rates and weekly OT. All times are Central."
      />
      <HoursSubnav from={fromStr} to={toStr} />

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <HoursPeopleList
          title="Employees"
          allLabel="All employees"
          action="/admin/hours"
          query={q}
          filters={{ from: fromStr, to: toStr }}
          selectedId={employeeId}
          hrefFor={(id) => href(id ? { employee: id } : {})}
          items={employees.filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()) || e.employeeId.toLowerCase().includes(q.toLowerCase()) || (e.exportCode ?? "").toLowerCase().includes(q.toLowerCase()) || (e.tcpNumber ?? "").includes(q)).map((e) => ({
            id: e.id,
            name: e.name,
            detail: `${e.exportCode ?? e.employeeId}${e.tcpNumber ? ` · TCP ${e.tcpNumber}` : ""}${e.employmentStatus === "TERMINATED" ? " · former" : e.employmentStatus === "INACTIVE" ? " · inactive" : ""}`,
          }))}
        />

        <div className="min-w-0 space-y-4">
          <HoursToolbarCard>
            <div className="flex min-w-0 flex-wrap items-end gap-3">
              <form method="get" action="/admin/hours" className="min-w-0 flex-1 basis-full sm:basis-auto">
                {employeeId ? <input type="hidden" name="employee" value={employeeId} /> : null}
                <HoursFilterRow>
                  <HoursField label="From" htmlFor="ih-from">
                    <FormDateField
                      key={fromStr}
                      id="ih-from"
                      name="from"
                      defaultValue={fromStr}
                      aria-label="From date"
                    />
                  </HoursField>
                  <HoursField label="To" htmlFor="ih-to">
                    <FormDateField
                      key={toStr}
                      id="ih-to"
                      name="to"
                      defaultValue={toStr}
                      aria-label="To date"
                    />
                  </HoursField>
                  <Button type="submit" size="sm" className="h-9 w-full sm:w-auto">
                    Update
                  </Button>
                  {selected && <DownloadEmployeeHoursButton employeeId={selected.id} from={fromStr} to={toStr} />}
                </HoursFilterRow>
              </form>
              <div className="contents sm:[&>[data-state=closed]]:w-auto">
                <ManualEntryButton
                  employees={employees
                    .filter(
                      (e) =>
                        e.employmentStatus === "ACTIVE" ||
                        (employeeId !== "" && e.id === employeeId),
                    )
                    .map((e) => ({
                      id: e.id,
                      name: e.name,
                      employeeId: e.employeeId,
                    }))}
                  jobCodes={jobCodes}
                  fixedEmployeeId={employeeId || undefined}
                />
              </div>
              <Button asChild size="sm" variant="secondary" className="min-h-11 sm:min-h-9">
                <Link href="/admin/hours/mass">Bulk entry</Link>
              </Button>
            </div>
            <HoursPresetChips
              presets={presets}
              activeFrom={fromStr}
              activeTo={toStr}
              hrefFor={(p) =>
                `/admin/hours?from=${p.from}&to=${p.to}${employeeId ? `&employee=${employeeId}` : ""}`
              }
            />
          </HoursToolbarCard>

          <HoursStatRow>
            <HoursStat label="Regular" value={formatHours(ot.regularMin)} />
            <HoursStat label="OT" value={formatHours(ot.overtimeMin)} />
            <HoursStat
              label="Total"
              value={formatHours(ot.regularMin + ot.overtimeMin)}
            />
            <HoursStat
              label="Scope"
              value={
                <span className="block truncate font-sans text-sm font-semibold">
                  {selected?.name ?? "All employees"}
                </span>
              }
            />
          </HoursStatRow>

          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border px-4 py-3">
              <CardTitle className="text-base font-semibold">
                Entries
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {formatDateOnly(from)} – {formatDateOnly(to)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No entries in range.
                </p>
              ) : (
                <div className="relative overflow-x-auto">
                  <table className={cn(hoursTableClass, "min-w-[720px]")}>
                    <thead className={hoursTheadClass}>
                      <tr>
                        <th className={hoursThClass}>Date</th>
                        {!employeeId && <th className={hoursThClass}>Employee</th>}
                        <th className={hoursThClass}>In</th>
                        <th className={hoursThClass}>Out</th>
                        <th className={cn(hoursThClass, "text-right")}>Break</th>
                        <th className={cn(hoursThClass, "text-right")}>Hours</th>
                        <th className={hoursThClass}>Job</th>
                        <th className={cn(hoursThClass, "text-right")}>Rate</th>
                        <th className={hoursThClass}>Status</th>
                        <th className={cn(hoursThClass, "w-10 text-right")}>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((e) => (
                        <Fragment key={e.id}>
                          <tr className={hoursRowClass}>
                            <td className={cn(hoursTdClass, "whitespace-nowrap")}>
                              {formatDateOnly(e.date)}
                            </td>
                            {!employeeId && (
                              <td className={hoursTdClass}>
                                <div className="flex items-center gap-2.5">
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
                                  <span className="min-w-0 truncate font-medium">
                                    {e.employeeName}
                                  </span>
                                </div>
                              </td>
                            )}
                            <td className={cn(hoursTdClass, "font-mono text-xs whitespace-nowrap")}>
                              {formatBusinessTime(e.clockIn)}
                            </td>
                            <td className={cn(hoursTdClass, "font-mono text-xs whitespace-nowrap")}>
                              {e.clockOut ? formatBusinessTime(e.clockOut) : "—"}
                            </td>
                            <td
                              className={cn(
                                hoursTdClass,
                                "text-right font-mono text-xs tabular-nums",
                              )}
                            >
                              {formatHours(e.totalBreakMin)}
                            </td>
                            <td
                              className={cn(
                                hoursTdClass,
                                "text-right font-mono text-xs tabular-nums",
                              )}
                            >
                              {formatHours(e.totalWorkMin)}
                            </td>
                            <td className={cn(hoursTdClass, "font-mono text-xs")}>{e.jobCode}</td>
                            <td
                              className={cn(
                                hoursTdClass,
                                "text-right font-mono text-xs tabular-nums",
                              )}
                            >
                              {e.rate != null ? `$${e.rate.toFixed(2)}` : "—"}
                            </td>
                            <td className={hoursTdClass}>
                              <div className="flex flex-col items-start gap-0.5">
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
                                  <span className="text-[10px] text-muted-foreground">Edited</span>
                                ) : null}
                              </div>
                            </td>
                            <td className={cn(hoursTdClass, "text-right")}>
                              <EntryActions entry={e} jobCodes={jobCodes} compact />
                            </td>
                          </tr>
                          <PanelSlotRow
                            id={entryPanelSlotId(e.id)}
                            colSpan={employeeId ? 9 : 10}
                          />
                        </Fragment>
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
