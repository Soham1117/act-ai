"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDateOnly } from "@/lib/format";
import {
  ClockOutButton,
  EndAssignmentButton,
  ReactivateButton,
  ResetPinButton,
  WorkerFormDialog,
  WorkerActiveButton,
} from "./worker-dialogs";
import { LiveBadge, type AgencyOption, type JobCodeOption, type WorkerRow } from "./shared";

export function WorkersTable({
  workers,
  agencies,
  jobCodes,
}: {
  workers: WorkerRow[];
  agencies: AgencyOption[];
  jobCodes: JobCodeOption[];
}) {
  if (workers.length === 0)
    return <p className="py-10 text-center text-sm text-muted-foreground">No contract workers match.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="p-3 font-medium">ID</th>
            <th className="p-3 font-medium">Name</th>
            <th className="p-3 font-medium">Agency</th>
            <th className="p-3 font-medium">Project / job code</th>
            <th className="p-3 font-medium">Dates</th>
            <th className="p-3 font-medium">Status</th>
            <th className="p-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((w) => (
            <tr key={w.id} className="border-b align-middle last:border-0">
              <td className="p-3 font-mono text-xs">{w.workerId}</td>
              <td className="p-3 font-medium">
                <Link href={`/admin/contract-workers/${w.id}`} className="hover:underline">
                  {w.name}
                </Link>
              </td>
              <td className="p-3">{w.agencyName}</td>
              <td className="p-3">
                <div>{w.project ?? "—"}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{w.jobCode ?? "no job code"}</div>
              </td>
              <td className="whitespace-nowrap p-3 text-xs">
                {formatDateOnly(w.startDate)} to {w.endDate ? formatDateOnly(w.endDate) : "open"}
              </td>
              <td className="p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {w.status !== "ACTIVE" ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {w.status === "INACTIVE" ? "Inactive" : "Ended"}
                    </Badge>
                  ) : (
                    <LiveBadge status={w.liveStatus} />
                  )}
                  {w.endingSoon && (
                    <Badge variant="warning" className="text-[10px]">
                      Ending soon
                    </Badge>
                  )}
                </div>
              </td>
              <td className="p-3">
                <div className="flex flex-wrap justify-end gap-1">
                  <WorkerFormDialog worker={w} agencies={agencies} jobCodes={jobCodes} trigger="edit" />
                  {w.liveStatus !== "OUT" && <ClockOutButton workerId={w.id} name={w.name} />}
                  <ResetPinButton workerId={w.id} name={w.name} />
                  {w.status !== "ENDED" && <WorkerActiveButton worker={w} />}
                  {w.status !== "ENDED" ? <EndAssignmentButton worker={w} /> : <ReactivateButton worker={w} />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
