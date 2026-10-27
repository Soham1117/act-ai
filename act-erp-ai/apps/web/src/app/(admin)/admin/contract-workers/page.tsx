import Link from "next/link";
import type { ApprovalStatus, ContractWorkerStatus } from "@prisma/client";
import { Activity, Clock, HardHat, Timer } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { businessDateOnly, formatBusinessTime, formatHours } from "@/lib/format";
import { addDaysDateOnly, dateOnlyToString, parseDateOnly, startOfBusinessWeek } from "@/lib/time-rules";
import {
  listAgencies,
  listContractTimeEntries,
  listContractWorkers,
  onSiteNow,
} from "@/server/queries/contract-workers";
import { AgenciesTable, AgencyFormDialog } from "./agencies-tab";
import { DownloadHoursCsvButton, HoursTable } from "./hours-table";
import { WorkerFormDialog, ClockOutButton } from "./worker-dialogs";
import { WorkersTable } from "./workers-table";
import { PunchPhotos } from "@/components/punch-photos";
import { selectClass, type AgencyRow, type HoursRow, type WorkerRow } from "./shared";

export const metadata = { title: "Contract workers" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TABS = ["workers", "on-site", "hours", "agencies"];

export default async function ContractWorkersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = TABS.includes(one(sp.tab)) ? one(sp.tab) : "workers";

  // Workers tab filters
  const agencyFilter = one(sp.agency);
  const statusFilter = one(sp.status);
  const status: ContractWorkerStatus | undefined =
    statusFilter === "ACTIVE" || statusFilter === "ENDED" || statusFilter === "INACTIVE" ? statusFilter : undefined;
  const q = one(sp.q).trim();

  // Hours tab filters (default: current Mon-Sun business week)
  const today = businessDateOnly();
  const weekStart = startOfBusinessWeek(today);
  const fromParsed = parseDateOnly(one(sp.from)) ?? weekStart;
  const toParsed = parseDateOnly(one(sp.to)) ?? addDaysDateOnly(weekStart, 6);
  const rangeFrom = fromParsed <= toParsed ? fromParsed : toParsed;
  const rangeTo = fromParsed <= toParsed ? toParsed : fromParsed;
  const hAgency = one(sp.hagency);
  const approvalRaw = one(sp.approval);
  const approval: ApprovalStatus | undefined =
    approvalRaw === "PENDING" || approvalRaw === "APPROVED" || approvalRaw === "REJECTED"
      ? approvalRaw
      : undefined;

  const [agencies, allWorkers, filteredWorkers, onSite, entries, jobCodes] = await Promise.all([
    listAgencies(),
    listContractWorkers({}),
    listContractWorkers({ agencyId: agencyFilter || undefined, status, search: q || undefined }),
    onSiteNow(),
    listContractTimeEntries({
      from: rangeFrom,
      to: rangeTo,
      agencyId: hAgency || undefined,
      approvalStatus: approval,
    }),
    db.jobCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, title: true },
    }),
  ]);

  const agencyOptions = agencies.map((a) => ({ id: a.id, name: a.name, isActive: a.isActive }));
  const activeCount = allWorkers.filter((w) => w.status === "ACTIVE").length;
  const endingSoonCount = allWorkers.filter((w) => w.endingSoon).length;

  const workerRows: WorkerRow[] = filteredWorkers.map((w) => ({
    id: w.id,
    workerId: w.workerId,
    name: w.name,
    phone: w.phone,
    agencyId: w.agencyId,
    agencyName: w.agencyName,
    jobCode: w.jobCode,
    project: w.project,
    startDate: dateOnlyToString(w.startDate),
    endDate: w.endDate ? dateOnlyToString(w.endDate) : null,
    status: w.status,
    notes: w.notes,
    liveStatus: w.liveStatus,
    endingSoon: w.endingSoon,
  }));

  const agencyRows: AgencyRow[] = agencies.map((a) => ({
    id: a.id,
    name: a.name,
    contactName: a.contactName,
    phone: a.phone,
    email: a.email,
    notes: a.notes,
    isActive: a.isActive,
    workerCount: a._count.workers,
  }));

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

  return (
    <>
      <PageHeader
        title="Contract workers"
        description="Agency staff on short projects. Separate from employees. No pay rates are stored. All times are Central."
        actions={<WorkerFormDialog agencies={agencyOptions} jobCodes={jobCodes} />}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="On site now" value={onSite.filter((e) => !e.stale).length} icon={<Activity className="h-4 w-4 text-primary" />} />
        <StatCard label="Active workers" value={activeCount} icon={<HardHat className="h-4 w-4" />} />
        <StatCard label="Ending this week" value={endingSoonCount} icon={<Timer className="h-4 w-4" />} />
      </div>

      <Tabs defaultValue={tab} className="mt-6 space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="workers">Workers ({allWorkers.length})</TabsTrigger>
          <TabsTrigger value="on-site">On site ({onSite.length})</TabsTrigger>
          <TabsTrigger value="hours">Hours</TabsTrigger>
          <TabsTrigger value="agencies">Agencies ({agencies.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="workers" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <form method="get" action="/admin/contract-workers" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tab" value="workers" />
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="cw-f-agency">Agency</label>
                  <select id="cw-f-agency" name="agency" defaultValue={agencyFilter} className={`${selectClass} h-9 w-52`}>
                    <option value="">All agencies</option>
                    {agencyOptions.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="cw-f-status">Status</label>
                  <select id="cw-f-status" name="status" defaultValue={status ?? ""} className={`${selectClass} h-9 w-36`}>
                    <option value="">All</option>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="ENDED">Ended</option>
                  </select>
                </div>
                <div className="min-w-[200px] flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="cw-f-q">Search</label>
                  <Input id="cw-f-q" name="q" defaultValue={q} placeholder="Name, ID, project, or agency" className="h-9" />
                </div>
                <Button type="submit" size="sm">Apply</Button>
                <Button asChild type="button" variant="ghost" size="sm">
                  <Link href="/admin/contract-workers?tab=workers">Reset</Link>
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <WorkersTable workers={workerRows} agencies={agencyOptions} jobCodes={jobCodes} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="on-site">
          <Card>
            <CardContent className="p-0">
              {onSite.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nobody is clocked in right now.</p>
              ) : (
                <ul className="divide-y">
                  {onSite.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-3 p-3">
                      <PunchPhotos
                        type="contract"
                        entryId={e.id}
                        hasIn={!!e.clockInPhotoKey}
                        hasOut={false}
                        source={e.kioskSlug !== null ? "KIOSK" : null}
                        clockIn={e.clockIn.toISOString()}
                        inOnly
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          <Link href={`/admin/contract-workers/${e.contractWorker.id}`} className="hover:underline">
                            {e.contractWorker.name}
                          </Link>{" "}
                          <span className="font-mono text-[11px] font-normal text-muted-foreground">
                            {e.contractWorker.workerId}
                          </span>
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {e.contractWorker.agency.name}
                          {e.contractWorker.project ? ` · ${e.contractWorker.project}` : ""} · in at{" "}
                          {formatBusinessTime(e.clockIn)}
                        </p>
                      </div>
                      {e.stale ? (
                        <Badge variant="destructive" className="text-[10px]">Open more than 16 hours</Badge>
                      ) : e.status === "ON_BREAK" ? (
                        <Badge variant="warning" className="text-[10px]">On break</Badge>
                      ) : (
                        <Badge variant="success" className="text-[10px]">Working</Badge>
                      )}
                      <ClockOutButton workerId={e.contractWorker.id} name={e.contractWorker.name} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hours" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <form method="get" action="/admin/contract-workers" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tab" value="hours" />
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="cw-h-from">From</label>
                  <Input id="cw-h-from" type="date" name="from" defaultValue={fromStr} className="h-9 w-40" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="cw-h-to">To</label>
                  <Input id="cw-h-to" type="date" name="to" defaultValue={toStr} className="h-9 w-40" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="cw-h-agency">Agency</label>
                  <select id="cw-h-agency" name="hagency" defaultValue={hAgency} className={`${selectClass} h-9 w-52`}>
                    <option value="">All agencies</option>
                    {agencyOptions.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="cw-h-approval">Approval</label>
                  <select id="cw-h-approval" name="approval" defaultValue={approval ?? ""} className={`${selectClass} h-9 w-36`}>
                    <option value="">All</option>
                    <option value="PENDING">Pending</option>
                    <option value="APPROVED">Approved</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                </div>
                <Button type="submit" size="sm">Apply</Button>
                <Button asChild type="button" variant="ghost" size="sm">
                  <Link href="/admin/contract-workers?tab=hours">Current week</Link>
                </Button>
                <div className="ml-auto">
                  <DownloadHoursCsvButton from={fromStr} to={toStr} agencyId={hAgency} />
                </div>
              </form>
            </CardContent>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Approved hours" value={formatHours(approvedMin)} icon={<Clock className="h-4 w-4 text-primary" />} />
            <StatCard label="Pending hours" value={formatHours(pendingMin)} icon={<Clock className="h-4 w-4" />} />
          </div>
          <Card>
            <CardContent className="p-0">
              <HoursTable rows={hoursRows} />
            </CardContent>
          </Card>
          <p className="text-[11px] text-muted-foreground">
            Totals follow the filters above. The CSV uses the date range and agency only, and merges
            several punches on one day into one row. Rejected entries add no hours.
          </p>
        </TabsContent>

        <TabsContent value="agencies">
          <Card>
            <CardContent className="p-0">
              <div className="flex justify-end border-b p-3">
                <AgencyFormDialog />
              </div>
              <AgenciesTable agencies={agencyRows} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
