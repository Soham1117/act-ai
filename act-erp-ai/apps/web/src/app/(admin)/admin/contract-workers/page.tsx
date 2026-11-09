import Link from "next/link";
import { redirect } from "next/navigation";
import type { ContractWorkerStatus } from "@prisma/client";
import { Activity, HardHat, Timer } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PanelSlot } from "@/components/inline-panel";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { FilterStack, MobileTabsList } from "@/components/mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBusinessTime } from "@/lib/format";
import {
  dateOnlyToString,
} from "@/lib/time-rules";
import {
  listAgencies,
  listContractWorkers,
  onSiteNow,
} from "@/server/queries/contract-workers";
import { AgenciesTable, AgencyForm } from "./agencies-tab";
import { WorkerForm, ClockOutButton } from "./worker-dialogs";
import { WorkersTable } from "./workers-table";
import { PunchPhotos } from "@/components/punch-photos";
import { FormSimpleSelect } from "@/components/simple-select";
import { type AgencyRow, type WorkerRow } from "./shared";

export const metadata = { title: "Contract workers" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TABS = ["workers", "on-site", "hours", "agencies"];

export default async function ContractWorkersPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = TABS.includes(one(sp.tab)) ? one(sp.tab) : "workers";
  if (tab === "hours") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (key !== "tab" && value !== undefined) {
        for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
      }
    }
    redirect(`/admin/hours/contract-workers${params.size ? `?${params}` : ""}`);
  }

  // Workers tab filters
  const agencyFilter = one(sp.agency);
  const statusFilter = one(sp.status);
  const status: ContractWorkerStatus | undefined =
    statusFilter === "ACTIVE" || statusFilter === "ENDED" || statusFilter === "INACTIVE"
      ? statusFilter
      : undefined;
  const q = one(sp.q).trim();

  const [agencies, allWorkers, filteredWorkers, onSite, jobCodes] =
    await Promise.all([
      listAgencies(),
      listContractWorkers({}),
      listContractWorkers({
        agencyId: agencyFilter || undefined,
        status,
        search: q || undefined,
      }),
      onSiteNow(),
      db.jobCode.findMany({
        where: { isActive: true },
        orderBy: { code: "asc" },
        select: { code: true, title: true },
      }),
    ]);

  const agencyOptions = agencies.map((a) => ({
    id: a.id,
    name: a.name,
    isActive: a.isActive,
  }));
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

  const onSiteByAgency = Array.from(
    onSite
      .filter((e) => !e.stale)
      .reduce((m, e) => m.set(e.contractWorker.agency.name, (m.get(e.contractWorker.agency.name) ?? 0) + 1), new Map<string, number>()),
  ).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));

  return (
    <>
      <PageHeader
        title="Contract workers"
        actions={<WorkerForm agencies={agencyOptions} jobCodes={jobCodes} panelSlot="add-contract-worker" />}
        description="Agency staff on short projects. Separate from employees. No pay rates are stored. All times are Central."
      />
      <PanelSlot id="add-contract-worker" />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="On site now"
          value={onSite.filter((e) => !e.stale).length}
          icon={<Activity className="h-4 w-4 text-primary" />}
        />
        <StatCard
          label="Active workers"
          value={activeCount}
          icon={<HardHat className="h-4 w-4" />}
        />
        <StatCard
          label="Ending this week"
          value={endingSoonCount}
          icon={<Timer className="h-4 w-4" />}
        />
      </div>
      {onSiteByAgency.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="On site now by agency">
          {onSiteByAgency.map(([agency, count]) => (
            <li
              key={agency}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs"
            >
              <span className="font-medium">{agency}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{count}</span>
            </li>
          ))}
        </ul>
      )}

      <Tabs defaultValue={tab} className="mt-6 space-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
        <MobileTabsList>
          <TabsTrigger value="workers">Workers ({allWorkers.length})</TabsTrigger>
          <TabsTrigger value="on-site">On site ({onSite.length})</TabsTrigger>
          <TabsTrigger value="agencies">Agencies ({agencies.length})</TabsTrigger>
        </MobileTabsList>
        <Button asChild variant="outline" size="sm" className="min-h-11 sm:ml-auto sm:min-h-9"><Link href="/admin/hours/contract-workers">View hours</Link></Button>
        </div>

        <TabsContent value="workers" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <form method="get" action="/admin/contract-workers">
                <FilterStack className="items-end">
                  <input type="hidden" name="tab" value="workers" />
                  <div className="w-full space-y-1 sm:w-auto">
                    <label
                      className="text-xs text-muted-foreground"
                      htmlFor="cw-f-agency"
                    >
                      Agency
                    </label>
                    <FormSimpleSelect
                      id="cw-f-agency"
                      name="agency"
                      defaultValue={agencyFilter}
                      className="h-9 w-full sm:w-52"
                      placeholder="All agencies"
                      options={[
                        { value: "", label: "All agencies" },
                        ...agencyOptions.map((a) => ({ value: a.id, label: a.name })),
                      ]}
                    />
                  </div>
                  <div className="w-full space-y-1 sm:w-auto">
                    <label
                      className="text-xs text-muted-foreground"
                      htmlFor="cw-f-status"
                    >
                      Status
                    </label>
                    <FormSimpleSelect
                      id="cw-f-status"
                      name="status"
                      defaultValue={status ?? ""}
                      className="h-9 w-full sm:w-36"
                      placeholder="All"
                      options={[
                        { value: "", label: "All" },
                        { value: "ACTIVE", label: "Active" },
                        { value: "INACTIVE", label: "Inactive" },
                        { value: "ENDED", label: "Ended" },
                      ]}
                    />
                  </div>
                  <div className="w-full flex-1 space-y-1">
                    <label className="text-xs text-muted-foreground" htmlFor="cw-f-q">
                      Search
                    </label>
                    <Input
                      id="cw-f-q"
                      name="q"
                      defaultValue={q}
                      placeholder="Name, ID, project, or agency"
                      className="h-9"
                    />
                  </div>
                  <Button type="submit" size="sm" className="w-full sm:w-auto">
                    Apply
                  </Button>
                  <Button
                    asChild
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full sm:w-auto"
                  >
                    <Link href="/admin/contract-workers?tab=workers">Reset</Link>
                  </Button>
                </FilterStack>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <WorkersTable
                workers={workerRows}
                agencies={agencyOptions}
                jobCodes={jobCodes}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="on-site">
          <Card>
            <CardContent className="p-0">
              {onSite.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nobody is clocked in right now.
                </p>
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
                          <Link
                            href={`/admin/contract-workers/${e.contractWorker.id}`}
                            className="hover:underline"
                          >
                            {e.contractWorker.name}
                          </Link>{" "}
                          <span className="font-mono text-[11px] font-normal text-muted-foreground">
                            {e.contractWorker.workerId}
                          </span>
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {e.contractWorker.agency.name}
                          {e.contractWorker.project
                            ? ` · ${e.contractWorker.project}`
                            : ""}{" "}
                          · in at {formatBusinessTime(e.clockIn)}
                        </p>
                      </div>
                      {e.stale ? (
                        <Badge variant="destructive" className="text-[10px]">
                          Open more than 16 hours
                        </Badge>
                      ) : e.status === "ON_BREAK" ? (
                        <Badge variant="warning" className="text-[10px]">
                          On break
                        </Badge>
                      ) : (
                        <Badge variant="success" className="text-[10px]">
                          Working
                        </Badge>
                      )}
                      <ClockOutButton
                        workerId={e.contractWorker.id}
                        name={e.contractWorker.name}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agencies">
          <Card>
            <CardContent className="p-0">
              <div className="flex justify-end border-b p-3">
                <AgencyForm />
              </div>
              <AgenciesTable agencies={agencyRows} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
