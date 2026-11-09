import Link from "next/link";
import type { ApprovalStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { HoursSubnav } from "@/components/hours-subnav";
import { HoursPeopleList } from "@/components/hours-people-list";
import {
  HoursField,
  HoursFilterRow,
  HoursPresetChips,
  HoursStat,
  HoursStatRow,
  HoursToolbarCard,
} from "@/components/hours-ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormDateField } from "@/components/date-field";
import { FormSimpleSelect } from "@/components/simple-select";
import { businessDateOnly, formatDateOnly, formatHours } from "@/lib/format";
import {
  addDaysDateOnly,
  dateOnlyToString,
  parseDateOnly,
  startOfBusinessWeek,
} from "@/lib/time-rules";
import { loadHoursPeriodPresets } from "@/lib/hours-period";
import {
  listAgencies,
  listContractTimeEntries,
  listContractWorkers,
} from "@/server/queries/contract-workers";
import { DownloadHoursCsvButton, HoursTable } from "../../contract-workers/hours-table";
import { AddContractEntryButton } from "../../contract-workers/add-entry-panel";
import type { HoursRow } from "../../contract-workers/shared";

export const metadata = { title: "Contract worker hours" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const PATH = "/admin/hours/contract-workers";

export default async function ContractHoursPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  // Preserve the contract hours default: current Mon–Sun business week.
  const weekStart = startOfBusinessWeek(businessDateOnly());
  const fromParsed = parseDateOnly(one(sp.from)) ?? weekStart;
  const toParsed = parseDateOnly(one(sp.to)) ?? addDaysDateOnly(weekStart, 6);
  const rangeFrom = fromParsed <= toParsed ? fromParsed : toParsed;
  const rangeTo = fromParsed <= toParsed ? toParsed : fromParsed;
  const hAgency = one(sp.hagency);
  const hWorker = one(sp.worker);
  const q = one(sp.q).trim();
  const approvalRaw = one(sp.approval);
  const approval: ApprovalStatus | undefined =
    approvalRaw === "PENDING" || approvalRaw === "APPROVED" || approvalRaw === "REJECTED"
      ? approvalRaw
      : undefined;
  const [agencies, allWorkers, entries, jobCodes, presets] = await Promise.all([
    listAgencies(),
    listContractWorkers({}),
    listContractTimeEntries({
      from: rangeFrom,
      to: rangeTo,
      agencyId: hAgency || undefined,
      workerId: hWorker || undefined,
      approvalStatus: approval,
    }),
    db.jobCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, title: true },
    }),
    loadHoursPeriodPresets(),
  ]);
  const hoursRows: HoursRow[] = entries.map((e) => ({
    id: e.id,
    date: dateOnlyToString(e.date),
    workerDbId: e.contractWorker.id,
    workerCode: e.contractWorker.workerId,
    workerName: e.contractWorker.name,
    agencyName: e.contractWorker.agency.name,
    project: e.contractWorker.project,
    jobCode: e.jobCode,
    clockIn: e.clockIn.toISOString(),
    clockOut: e.clockOut?.toISOString() ?? null,
    totalBreakMin: e.totalBreakMin,
    totalWorkMin: e.totalWorkMin,
    isOpen: e.status === "ACTIVE" || e.status === "ON_BREAK",
    approvalStatus: e.approvalStatus,
    approvalNotes: e.approvalNotes,
    editReason: e.editReason,
    autoClosed: e.autoClosed,
    fromKiosk: e.kioskSlug !== null,
    hasClockInPhoto: !!e.clockInPhotoKey,
    hasClockOutPhoto: !!e.clockOutPhotoKey,
  }));
  const approvedMin = hoursRows
    .filter((r) => r.approvalStatus === "APPROVED")
    .reduce((s, r) => s + r.totalWorkMin, 0);
  const pendingMin = hoursRows
    .filter((r) => r.approvalStatus === "PENDING" && !r.isOpen)
    .reduce((s, r) => s + r.totalWorkMin, 0);

  const fromStr = dateOnlyToString(rangeFrom);
  const toStr = dateOnlyToString(rangeTo);

  const selected = allWorkers.find((w) => w.id === hWorker);
  const filters = {
    from: fromStr,
    to: toStr,
    ...(hAgency ? { hagency: hAgency } : {}),
    ...(approval ? { approval } : {}),
  };
  const href = (extra: Record<string, string> = {}) =>
    `${PATH}?${new URLSearchParams({ ...filters, ...extra })}`;
  const workers = allWorkers.filter(
    (w) =>
      (!hAgency || w.agencyId === hAgency) &&
      (!q ||
        `${w.name} ${w.workerId} ${w.agencyName} ${w.project ?? ""}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );

  return (
    <>
      <PageHeader
        title="Contract worker hours"
        description="Agency staff entries and approvals. All times are Central."
      />
      <HoursSubnav from={fromStr} to={toStr} />
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <HoursPeopleList
          title="Contract workers"
          allLabel="All contract workers"
          action={PATH}
          query={q}
          filters={filters}
          selectedId={hWorker}
          hrefFor={(id) => href(id ? { worker: id } : {})}
          items={workers.map((w) => ({
            id: w.id,
            name: w.name,
            detail: `${w.workerId} · ${w.agencyName}${w.status === "ENDED" ? " · ended" : w.status === "INACTIVE" ? " · inactive" : ""}`,
          }))}
        />
        <div className="min-w-0 space-y-4">
          <HoursToolbarCard>
            <div className="flex min-w-0 flex-wrap items-end gap-3">
              <form method="get" action={PATH} className="min-w-0 flex-1 basis-full">
                {hWorker && <input type="hidden" name="worker" value={hWorker} />}
                <HoursFilterRow>
                  <HoursField label="From" htmlFor="cw-h-from">
                    <FormDateField
                      key={fromStr}
                      id="cw-h-from"
                      name="from"
                      defaultValue={fromStr}
                      aria-label="From date"
                    />
                  </HoursField>
                  <HoursField label="To" htmlFor="cw-h-to">
                    <FormDateField
                      key={toStr}
                      id="cw-h-to"
                      name="to"
                      defaultValue={toStr}
                      aria-label="To date"
                    />
                  </HoursField>
                  <HoursField label="Agency" htmlFor="cw-h-agency">
                    <FormSimpleSelect
                      key={hAgency}
                      id="cw-h-agency"
                      name="hagency"
                      defaultValue={hAgency}
                      className="h-11 w-full sm:h-9 sm:w-44"
                      placeholder="All agencies"
                      options={[
                        { value: "", label: "All agencies" },
                        ...agencies.map((a) => ({ value: a.id, label: a.name })),
                      ]}
                    />
                  </HoursField>
                  <HoursField label="Approval" htmlFor="cw-h-approval">
                    <FormSimpleSelect
                      id="cw-h-approval"
                      name="approval"
                      defaultValue={approval ?? ""}
                      className="h-11 w-full sm:h-9 sm:w-36"
                      placeholder="All"
                      options={[
                        { value: "", label: "All" },
                        { value: "PENDING", label: "Pending" },
                        { value: "APPROVED", label: "Approved" },
                        { value: "REJECTED", label: "Rejected" },
                      ]}
                    />
                  </HoursField>
                  <Button
                    type="submit"
                    size="sm"
                    className="min-h-11 w-full sm:min-h-9 sm:w-auto"
                  >
                    Update
                  </Button>
                  <DownloadHoursCsvButton
                    from={fromStr}
                    to={toStr}
                    agencyId={hAgency}
                    workerId={hWorker}
                  />
                </HoursFilterRow>
              </form>
              <div className="flex w-full min-w-0 flex-wrap items-start gap-2">
                <AddContractEntryButton
                  workers={allWorkers.map((w) => ({
                    id: w.id,
                    name: w.name,
                    workerId: w.workerId,
                    jobCode: w.jobCode,
                    startDate: dateOnlyToString(w.startDate),
                    endDate: w.endDate ? dateOnlyToString(w.endDate) : null,
                    status: w.status,
                  }))}
                  jobCodes={jobCodes}
                  fixedWorkerId={hWorker || undefined}
                />
                <Button
                  asChild
                  size="sm"
                  variant="secondary"
                  className="min-h-11 sm:min-h-9"
                >
                  <Link href="/admin/contract-workers/mass">Bulk entry</Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="min-h-11 sm:ml-auto sm:min-h-9"
                >
                  <Link href={PATH}>Current week</Link>
                </Button>
              </div>
            </div>
            <HoursPresetChips
              presets={presets}
              activeFrom={fromStr}
              activeTo={toStr}
              hrefFor={(p) =>
                href({ from: p.from, to: p.to, ...(hWorker ? { worker: hWorker } : {}) })
              }
            />
          </HoursToolbarCard>
          <HoursStatRow>
            <HoursStat label="Approved" value={formatHours(approvedMin)} />
            <HoursStat label="Pending" value={formatHours(pendingMin)} />
            <HoursStat label="Entries" value={hoursRows.length} />
            <HoursStat
              label="Scope"
              value={
                <span
                  className="block truncate font-sans text-sm font-semibold"
                  title={selected?.name}
                >
                  {selected?.name ?? "All contract workers"}
                </span>
              }
            />
          </HoursStatRow>
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border px-4 py-3">
              <CardTitle className="text-base font-semibold">
                Entries
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {formatDateOnly(rangeFrom)} – {formatDateOnly(rangeTo)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <HoursTable rows={hoursRows} />
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            Totals follow the filters above. Excel export uses the date range, agency, and
            selected worker and combines each worker’s punches by day. Rejected entries
            add no hours.
          </p>
        </div>
      </div>
    </>
  );
}
