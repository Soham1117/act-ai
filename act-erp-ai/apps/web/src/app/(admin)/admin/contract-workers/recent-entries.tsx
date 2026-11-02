"use client";

import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { PunchPhotos } from "@/components/punch-photos";
import { PanelSlot, PanelSlotRow } from "@/components/inline-panel";
import { formatBusinessTime, formatDateOnly, formatHours } from "@/lib/format";
import { DataListCard, ResponsiveDataList } from "@/components/mobile";
import { ContractEntryRowActions } from "./entry-row-actions";
import { ApprovalBadge } from "./shared";

export type RecentEntryRow = {
  id: string;
  date: string;
  clockIn: string;
  clockOut: string | null;
  totalBreakMin: number;
  totalWorkMin: number;
  isOpen: boolean;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  autoClosed: boolean;
  hasClockInPhoto: boolean;
  hasClockOutPhoto: boolean;
  fromKiosk: boolean;
};

export function RecentContractEntries({
  workerName,
  entries,
}: {
  workerName: string;
  entries: RecentEntryRow[];
}) {
  if (entries.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No time entries yet.
      </p>
    );
  }

  return (
    <ResponsiveDataList
      mobile={
        <div className="space-y-2 p-2">
          {entries.map((e) => (
            <Fragment key={e.id}>
              <DataListCard>
                <div className="space-y-2 text-sm">
                  <p className="text-xs text-muted-foreground">
                    {formatDateOnly(e.date)}
                  </p>
                  <p className="font-mono text-xs">
                    {formatBusinessTime(e.clockIn)}
                    {e.clockOut ? ` → ${formatBusinessTime(e.clockOut)}` : " → open"}
                  </p>
                  <p className="font-mono text-xs tabular-nums">
                    Work {e.isOpen ? "—" : formatHours(e.totalWorkMin)} · breaks{" "}
                    {formatHours(e.totalBreakMin)}
                  </p>
                  <PunchPhotos
                    type="contract"
                    entryId={e.id}
                    hasIn={e.hasClockInPhoto}
                    hasOut={e.hasClockOutPhoto}
                    source={e.fromKiosk ? "KIOSK" : null}
                    clockIn={e.clockIn}
                    clockOut={e.clockOut}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <ApprovalBadge status={e.approvalStatus} open={e.isOpen} />
                    {e.autoClosed && (
                      <Badge variant="destructive" className="text-[10px]">
                        Auto-closed
                      </Badge>
                    )}
                  </div>
                  <ContractEntryRowActions
                    entry={{
                      id: e.id,
                      workerName,
                      clockIn: e.clockIn,
                      clockOut: e.clockOut,
                      isOpen: e.isOpen,
                    }}
                    panelSlotId={`detail-${e.id}`}
                  />
                </div>
              </DataListCard>
              <PanelSlot id={`detail-${e.id}`} view="mobile" />
            </Fragment>
          ))}
        </div>
      }
      desktop={
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
                <th className="p-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <Fragment key={e.id}>
                  <tr className="border-b align-middle last:border-0 [&:has(+tr_[data-panel-open])]:bg-primary/10">
                    <td className="whitespace-nowrap p-3 text-xs">
                      {formatDateOnly(e.date)}
                    </td>
                    <td className="whitespace-nowrap p-3 font-mono text-xs">
                      {formatBusinessTime(e.clockIn)}
                      {e.clockOut ? ` → ${formatBusinessTime(e.clockOut)}` : " → open"}
                    </td>
                    <td className="p-3 text-right font-mono text-xs tabular-nums">
                      {formatHours(e.totalBreakMin)}
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums">
                      {e.isOpen ? "—" : formatHours(e.totalWorkMin)}
                    </td>
                    <td className="p-3">
                      <PunchPhotos
                        type="contract"
                        entryId={e.id}
                        hasIn={e.hasClockInPhoto}
                        hasOut={e.hasClockOutPhoto}
                        source={e.fromKiosk ? "KIOSK" : null}
                        clockIn={e.clockIn}
                        clockOut={e.clockOut}
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1.5">
                        <ApprovalBadge status={e.approvalStatus} open={e.isOpen} />
                        {e.autoClosed && (
                          <Badge variant="destructive" className="text-[10px]">
                            Auto-closed
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <ContractEntryRowActions
                        entry={{
                          id: e.id,
                          workerName,
                          clockIn: e.clockIn,
                          clockOut: e.clockOut,
                          isOpen: e.isOpen,
                        }}
                        panelSlotId={`detail-${e.id}`}
                      />
                    </td>
                  </tr>
                  <PanelSlotRow id={`detail-${e.id}`} colSpan={7} />
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      }
    />
  );
}
