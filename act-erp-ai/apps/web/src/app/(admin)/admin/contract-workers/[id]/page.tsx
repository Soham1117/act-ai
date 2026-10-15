import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PunchPhotos } from "@/components/punch-photos";
import { formatBusinessTime, formatDateOnly, formatHours, formatPhone } from "@/lib/format";
import { getContractWorker, listContractWorkers } from "@/server/queries/contract-workers";
import { ApprovalBadge } from "../shared";

export const metadata = { title: "Contract worker" };

export default async function ContractWorkerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const worker = await getContractWorker(id, 50);
  if (!worker) notFound();
  const live = (await listContractWorkers({ agencyId: worker.agencyId })).find((w) => w.id === id);

  return (
    <>
      <div className="mb-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/contract-workers">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Contract workers
          </Link>
        </Button>
      </div>
      <PageHeader
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
              {worker.status === "ACTIVE" ? "Active" : "Ended"}
            </Badge>
            {live?.endingSoon && <Badge variant="warning">Ending soon</Badge>}
          </>
        }
      />
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
              <Row label="End" value={worker.endDate ? formatDateOnly(worker.endDate) : "Open"} />
              <Row label="Phone" value={formatPhone(worker.phone)} />
              <Row label="Notes" value={worker.notes ?? "—"} />
            </dl>
            <p className="mt-4 text-[11px] text-muted-foreground">
              Edit, end, or reactivate from the <Link className="underline" href="/admin/contract-workers">workers list</Link>.
            </p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent entries ({worker.timeEntries.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {worker.timeEntries.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No time entries yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="p-3 font-medium">Date</th>
                      <th className="p-3 font-medium">Times</th>
                      <th className="p-3 text-right font-medium">Breaks</th>
                      <th className="p-3 text-right font-medium">Work</th>
                      <th className="p-3 font-medium">Photos</th>
                      <th className="p-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worker.timeEntries.map((e) => {
                      const open = e.status === "ACTIVE" || e.status === "ON_BREAK";
                      return (
                        <tr key={e.id} className="border-b last:border-0">
                          <td className="whitespace-nowrap p-3 text-xs">{formatDateOnly(e.date)}</td>
                          <td className="whitespace-nowrap p-3 font-mono text-xs">
                            {formatBusinessTime(e.clockIn)}
                            {e.clockOut ? ` → ${formatBusinessTime(e.clockOut)}` : " → open"}
                          </td>
                          <td className="p-3 text-right font-mono text-xs tabular-nums">
                            {formatHours(e.totalBreakMin)}
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums">
                            {open ? "—" : formatHours(e.totalWorkMin)}
                          </td>
                          <td className="p-3">
                            <PunchPhotos
                              type="contract"
                              entryId={e.id}
                              hasIn={!!e.clockInPhotoKey}
                              hasOut={!!e.clockOutPhotoKey}
                              source={e.kioskSlug !== null ? "KIOSK" : null}
                              clockIn={e.clockIn.toISOString()}
                              clockOut={e.clockOut?.toISOString() ?? null}
                            />
                          </td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1.5">
                              <ApprovalBadge status={e.approvalStatus} open={open} />
                              {e.autoClosed && (
                                <Badge variant="destructive" className="text-[10px]">
                                  Auto-closed
                                </Badge>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
