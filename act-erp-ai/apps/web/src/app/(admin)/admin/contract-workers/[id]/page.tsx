import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateOnly, formatPhone } from "@/lib/format";
import { dateOnlyToString } from "@/lib/time-rules";
import {
  getContractWorker,
  listContractWorkers,
} from "@/server/queries/contract-workers";
import { AddContractEntryButton } from "../add-entry-panel";
import { RecentContractEntries } from "../recent-entries";

export const metadata = { title: "Contract worker" };

export default async function ContractWorkerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const [worker, jobCodes] = await Promise.all([
    getContractWorker(id, 50),
    db.jobCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, title: true },
    }),
  ]);
  if (!worker) notFound();
  const live = (await listContractWorkers({ agencyId: worker.agencyId })).find(
    (w) => w.id === id,
  );
  const entryWorker = {
    id: worker.id,
    name: worker.name,
    workerId: worker.workerId,
    jobCode: worker.jobCode,
    startDate: dateOnlyToString(worker.startDate),
    endDate: worker.endDate ? dateOnlyToString(worker.endDate) : null,
    status: worker.status,
  };
  const entries = worker.timeEntries.map((e) => {
    const open = e.status === "ACTIVE" || e.status === "ON_BREAK";
    return {
      id: e.id,
      date: dateOnlyToString(e.date),
      clockIn: e.clockIn.toISOString(),
      clockOut: e.clockOut?.toISOString() ?? null,
      totalBreakMin: e.totalBreakMin,
      totalWorkMin: e.totalWorkMin,
      isOpen: open,
      approvalStatus: e.approvalStatus as "PENDING" | "APPROVED" | "REJECTED",
      autoClosed: e.autoClosed,
      hasClockInPhoto: !!e.clockInPhotoKey,
      hasClockOutPhoto: !!e.clockOutPhotoKey,
      fromKiosk: e.kioskSlug !== null,
    };
  });

  return (
    <>
      <PageHeader
        back={{ href: "/admin/contract-workers", label: "Contract workers" }}
        title={worker.name}
        description={
          <span className="font-mono">
            {worker.workerId} · {worker.agency.name}
          </span>
        }
        actions={
          <>
            {live?.liveStatus === "ACTIVE" && <Badge variant="success">On site</Badge>}
            {live?.liveStatus === "ON_BREAK" && <Badge variant="warning">On break</Badge>}
            <Badge variant={worker.status === "ACTIVE" ? "success" : "secondary"}>
              {worker.status === "ACTIVE"
                ? "Active"
                : worker.status === "INACTIVE"
                  ? "Inactive"
                  : "Ended"}
            </Badge>
            {live?.endingSoon && <Badge variant="warning">Ending soon</Badge>}
          </>
        }
      />
      <div className="mb-4">
        <AddContractEntryButton
          workers={[entryWorker]}
          jobCodes={jobCodes}
          fixedWorkerId={worker.id}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assignment</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Agency" value={worker.agency.name} />
              <Row label="Project" value={worker.project ?? "—"} />
              <Row label="Job code" value={worker.jobCode ?? "—"} />
              <Row label="Start" value={formatDateOnly(worker.startDate)} />
              <Row
                label="End"
                value={worker.endDate ? formatDateOnly(worker.endDate) : "Open"}
              />
              <Row label="Phone" value={formatPhone(worker.phone)} />
              <Row label="Notes" value={worker.notes ?? "—"} />
            </dl>
            <p className="mt-4 text-[11px] text-muted-foreground">
              Edit, make inactive, end, or reactivate from the{" "}
              <Link className="underline" href="/admin/contract-workers">
                workers list
              </Link>
              .
            </p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              Recent entries ({entries.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <RecentContractEntries workerName={worker.name} entries={entries} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words sm:text-right">{value}</dd>
    </div>
  );
}
