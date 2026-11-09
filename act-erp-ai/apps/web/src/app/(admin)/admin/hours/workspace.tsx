import { effectiveRate } from "@/lib/time-rate";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { HoursSubnav } from "@/components/hours-subnav";
import {
  HoursField,
  HoursFilterRow,
  HoursPresetChips,
  HoursToolbarCard,
} from "@/components/hours-ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HoursPeopleList } from "@/components/hours-people-list";
import { FormDateField } from "@/components/date-field";
import { formatDateOnly, getAvatarUrl } from "@/lib/format";
import { dateOnlyToString } from "@/lib/time-rules";
import { loadHoursPeriodPresets, resolveHoursRange } from "@/lib/hours-period";
import { EmployeeHoursTable, ManualEntryButton } from "../time-tracking/time-tools";
import { type EntryRowData } from "../time-tracking/time-types";
import { DownloadEmployeeHoursButton } from "./download-employee-hours";

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

export async function EmployeeHoursWorkspace({
  searchParams,
  approvalsOnly = false,
}: {
  searchParams: Promise<SP>;
  approvalsOnly?: boolean;
}) {
  const PATH = approvalsOnly ? "/admin/hours/approvals" : "/admin/hours";
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = resolveHoursRange(one(sp.from), one(sp.to));
  const employeeId = one(sp.employee).trim();
  const q = one(sp.q).trim();

  const [presets, employees, jobCodes, entries] = await Promise.all([
    loadHoursPeriodPresets(),
    db.employee.findMany({
      where: {
        employmentStatus: { in: ["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED"] },
      },
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
        ...(approvalsOnly
          ? {
              approvalStatus: "PENDING" as const,
              status: "COMPLETED" as const,
              clockOut: { not: null },
            }
          : {}),
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

  const href = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ from: fromStr, to: toStr, ...extra });
    return `${PATH}?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title={approvalsOnly ? "Employee approvals" : "Employee hours"}
        description="Punch-level hours with rates and weekly OT. All times are Central."
      />
      <HoursSubnav from={fromStr} to={toStr} />

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <HoursPeopleList
          title="Employees"
          allLabel="All employees"
          action={PATH}
          query={q}
          filters={{ from: fromStr, to: toStr }}
          selectedId={employeeId}
          hrefFor={(id) => href(id ? { employee: id } : {})}
          items={employees
            .filter(
              (e) =>
                !q ||
                e.name.toLowerCase().includes(q.toLowerCase()) ||
                e.employeeId.toLowerCase().includes(q.toLowerCase()) ||
                (e.exportCode ?? "").toLowerCase().includes(q.toLowerCase()) ||
                (e.tcpNumber ?? "").includes(q),
            )
            .map((e) => ({
              id: e.id,
              name: e.name,
              detail: `${e.exportCode ?? e.employeeId}${e.tcpNumber ? ` · TCP ${e.tcpNumber}` : ""}${e.employmentStatus === "TERMINATED" ? " · former" : e.employmentStatus === "INACTIVE" ? " · inactive" : ""}`,
            }))}
        />

        <div className="min-w-0 space-y-4">
          <HoursToolbarCard>
            <div className="flex min-w-0 flex-wrap items-end gap-3">
              <HoursPresetChips
                presets={presets}
                activeFrom={fromStr}
                activeTo={toStr}
                hrefFor={(p) =>
                  `${PATH}?from=${p.from}&to=${p.to}${employeeId ? `&employee=${employeeId}` : ""}`
                }
              />
              <form
                id="employee-hours-filters"
                method="get"
                action={PATH}
                className="contents"
              >
                {employeeId ? (
                  <input type="hidden" name="employee" value={employeeId} />
                ) : null}
                <HoursFilterRow className="contents sm:contents">
                  <HoursField label="From" className="sm:w-36" htmlFor="ih-from">
                    <FormDateField
                      key={fromStr}
                      id="ih-from"
                      name="from"
                      defaultValue={fromStr}
                      aria-label="From date"
                      className="min-h-11 md:min-h-9 sm:w-full"
                    />
                  </HoursField>
                  <HoursField label="To" className="sm:w-36" htmlFor="ih-to">
                    <FormDateField
                      key={toStr}
                      id="ih-to"
                      name="to"
                      defaultValue={toStr}
                      aria-label="To date"
                      className="min-h-11 md:min-h-9 sm:w-full"
                    />
                  </HoursField>
                  <Button type="submit" size="sm" className="min-h-11 w-full sm:w-auto md:min-h-9">
                    Update
                  </Button>
                </HoursFilterRow>
              </form>
              <div className="contents">
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
                <Button
                  asChild
                  size="sm"
                  variant="secondary"
                  className="min-h-11 md:min-h-9"
                >
                  <Link href="/admin/hours/mass">Bulk entry</Link>
                </Button>
                {selected && (
                  <DownloadEmployeeHoursButton
                    employeeId={selected.id}
                    from={fromStr}
                    to={toStr}
                    formId="employee-hours-filters"
                  />
                )}
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="min-h-11 md:min-h-9"
                >
                  <Link href={PATH}>Current period</Link>
                </Button>
              </div>
            </div>
          </HoursToolbarCard>


          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border px-4 py-3">
              <CardTitle className="text-base font-semibold">
                {approvalsOnly ? "Pending approval" : "Entries"}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {formatDateOnly(from)} – {formatDateOnly(to)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <EmployeeHoursTable entries={rows} jobCodes={jobCodes} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
