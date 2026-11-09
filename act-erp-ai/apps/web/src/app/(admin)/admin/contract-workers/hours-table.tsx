"use client";

import { Fragment, useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  InlinePanel,
  PanelSlot,
  PanelSlotRow,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
} from "@/components/inline-panel";
import { PunchPhotos } from "@/components/punch-photos";
import { runAction, toastAction } from "@/lib/toast-action";
import { formatBusinessTime, formatDateOnly, formatHours } from "@/lib/format";
import {
  bulkReviewContractTimeEntries,
  reviewContractTimeEntry,
} from "@/server/actions/contract-workers";
import { exportContractHoursWorkbook } from "./export-actions";
import { ContractEntryRowActions } from "./entry-row-actions";
import { DataListCard, ResponsiveDataList } from "@/components/mobile";
import { hoursRowClass, hoursTableClass, hoursTdClass, hoursThClass, hoursTheadClass } from "@/components/hours-ui";
import { cn } from "@/lib/utils";
import { ApprovalBadge, type HoursRow } from "./shared";

const canReview = (r: HoursRow) =>
  !r.isOpen && r.clockOut !== null && r.approvalStatus === "PENDING";

export function DownloadHoursCsvButton({
  from,
  to,
  agencyId,
  workerId,
}: {
  from: string;
  to: string;
  agencyId: string;
  workerId?: string;
}) {
  const [pending, startTransition] = useTransition();
  function download(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    const data = form ? new FormData(form) : null;
    const input = {
      from: String(data?.get("from") ?? from),
      to: String(data?.get("to") ?? to),
      agencyId: String(data?.get("hagency") ?? agencyId) || undefined,
      workerId: String(data?.get("worker") ?? workerId ?? "") || undefined,
    };
    startTransition(async () => {
      const res = await runAction(() =>
        exportContractHoursWorkbook(input),
      );
      if (!toastAction(res)) return;
      // Empty range: nothing to export.
      if (!res.xlsx) {
        toast.info("No entries in this range, so there is nothing to export.");
        return;
      }
      const blob = new Blob([Uint8Array.from(atob(res.xlsx), (c) => c.charCodeAt(0))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Excel downloaded");
    });
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={download}
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="mr-1.5 h-3.5 w-3.5" />
      )}
      Download Excel
    </Button>
  );
}

export function HoursTable({ rows }: { rows: HoursRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectIds, setRejectIds] = useState<string[] | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const reviewable = rows.filter(canReview);
  // Drop selections that are no longer reviewable after a refresh.
  const activeSelected = reviewable.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected =
    reviewable.length > 0 && activeSelected.length === reviewable.length;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function approve(ids: string[]) {
    startTransition(async () => {
      if (ids.length === 1) {
        const res = await runAction(() =>
          reviewContractTimeEntry({ id: ids[0]!, decision: "APPROVED" }),
        );
        if (!toastAction(res)) return;
        toast.success("Entry approved");
      } else {
        const res = await runAction(() =>
          bulkReviewContractTimeEntries({ ids, decision: "APPROVED" }),
        );
        if (!toastAction(res)) return;
        toast.success(
          res.skipped > 0
            ? `Approved ${res.updated}, skipped ${res.skipped} that were not pending`
            : `Approved ${res.updated} entries`,
        );
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  function reject() {
    const ids = rejectIds;
    const notes = rejectNotes.trim();
    if (!ids) return;
    if (!notes) return toast.error("Enter a reason for rejecting.");
    startTransition(async () => {
      if (ids.length === 1) {
        const res = await runAction(() =>
          reviewContractTimeEntry({ id: ids[0]!, decision: "REJECTED", notes }),
        );
        if (!toastAction(res)) return;
        toast.success("Entry rejected");
      } else {
        const res = await runAction(() =>
          bulkReviewContractTimeEntries({ ids, decision: "REJECTED", notes }),
        );
        if (!toastAction(res)) return;
        toast.success(
          res.skipped > 0
            ? `Rejected ${res.updated}, skipped ${res.skipped} that were not pending`
            : `Rejected ${res.updated} entries`,
        );
      }
      setRejectIds(null);
      setRejectNotes("");
      setSelected(new Set());
      router.refresh();
    });
  }

  if (rows.length === 0)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No entries in this range.
      </p>
    );

  return (
    <>
      {activeSelected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-3 text-sm">
          <span>{activeSelected.length} selected</span>
          <Button size="sm" disabled={pending} onClick={() => approve(activeSelected)}>
            {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Approve selected
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              setRejectNotes("");
              setRejectIds(activeSelected);
            }}
          >
            Reject selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      <ResponsiveDataList
        mobile={
          <div className="space-y-2 p-2">
            {rows.map((r) => (
              <Fragment key={r.id}>
              <DataListCard>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    {canReview(r) && (
                      <Checkbox
                        aria-label={`Select entry for ${r.workerName}`}
                        checked={selected.has(r.id)}
                        onCheckedChange={(v) => toggle(r.id, v === true)}
                        className="mt-0.5"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">
                        {formatDateOnly(r.date)}
                      </p>
                      <Link
                        href={`/admin/contract-workers/${r.workerDbId}`}
                        className="block truncate text-sm font-medium hover:underline"
                        title={r.workerName}
                      >
                        {r.workerName}
                      </Link>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {r.workerCode}
                        {r.project ? ` · ${r.project}` : ""}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={r.agencyName}>{r.agencyName}</p>
                      <p className="font-mono text-xs">
                        {formatBusinessTime(r.clockIn)}
                        {r.clockOut ? ` → ${formatBusinessTime(r.clockOut)}` : " → open"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <ApprovalBadge status={r.approvalStatus} open={r.isOpen} />
                        {r.autoClosed && (
                          <Badge variant="destructive" className="text-[10px]">
                            Auto-closed
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 font-mono text-xs tabular-nums">
                        Work {r.isOpen ? "—" : formatHours(r.totalWorkMin)} · breaks{" "}
                        {formatHours(r.totalBreakMin)}
                      </p>
                      <PunchPhotos
                        type="contract"
                        entryId={r.id}
                        hasIn={r.hasClockInPhoto}
                        hasOut={r.hasClockOutPhoto}
                        source={r.fromKiosk ? "KIOSK" : null}
                        clockIn={r.clockIn}
                        clockOut={r.clockOut}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {canReview(r) && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          aria-label={`Approve entry for ${r.workerName}`}
                          onClick={() => approve([r.id])}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          aria-label={`Reject entry for ${r.workerName}`}
                          onClick={() => {
                            setRejectNotes("");
                            setRejectIds([r.id]);
                          }}
                        >
                          <X className="mr-1 h-3.5 w-3.5" />
                          Reject
                        </Button>
                      </>
                    )}
                    <ContractEntryRowActions
                      entry={{
                        id: r.id,
                        workerName: r.workerName,
                        clockIn: r.clockIn,
                        clockOut: r.clockOut,
                        isOpen: r.isOpen,
                      }}
                      panelSlotId={`hours-${r.id}`}
                    />
                  </div>
                </div>
              </DataListCard>
              <PanelSlot id={`hours-${r.id}`} view="mobile" />
              </Fragment>
            ))}
          </div>
        }
        desktop={
          <div className="overflow-x-auto">
            <table data-sorter="1" className={cn(hoursTableClass, "min-w-[900px]")}>
              <thead className={hoursTheadClass}>
                <tr className="text-left">
                  <th className={cn(hoursThClass, "w-10")}>
                    <Checkbox
                      aria-label="Select all pending entries"
                      disabled={reviewable.length === 0}
                      checked={allSelected}
                      onCheckedChange={(v) =>
                        setSelected(
                          v === true ? new Set(reviewable.map((r) => r.id)) : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className={hoursThClass}>Date</th>
                  <th className={hoursThClass}>Worker</th>
                  <th className={hoursThClass}>In</th>
                  <th className={hoursThClass}>Out</th>
                  <th className={cn(hoursThClass, "text-right")}>Break</th>
                  <th className={cn(hoursThClass, "text-right")}>Hours</th>
                  <th className={hoursThClass}>Agency</th>
                  <th className={hoursThClass}>Photos</th>
                  <th className={hoursThClass}>Status</th>
                  <th className={cn(hoursThClass, "text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                  <tr className={cn(hoursRowClass, "last:border-0 [&:has(+tr_[data-panel-open])]:bg-primary/10")}>
                    <td className={hoursTdClass}>
                      {canReview(r) && (
                        <Checkbox
                          aria-label={`Select entry for ${r.workerName}`}
                          checked={selected.has(r.id)}
                          onCheckedChange={(v) => toggle(r.id, v === true)}
                        />
                      )}
                    </td>
                    <td className={cn(hoursTdClass, "whitespace-nowrap text-xs")}>
                      {formatDateOnly(r.date)}
                    </td>
                    <td className={hoursTdClass}>
                      <Link
                        href={`/admin/contract-workers/${r.workerDbId}`}
                        className="block max-w-48 truncate font-medium hover:underline"
                        title={r.workerName}
                      >
                        {r.workerName}
                      </Link>
                      <div className="max-w-48 truncate font-mono text-[11px] text-muted-foreground">
                        {r.workerCode}
                        {r.project ? ` · ${r.project}` : ""}
                      </div>
                    </td>
                    <td className={cn(hoursTdClass, "whitespace-nowrap font-mono text-xs")}>
                      {formatBusinessTime(r.clockIn)}
                    </td>
                    <td className={cn(hoursTdClass, "whitespace-nowrap font-mono text-xs")}>
                      {r.clockOut ? formatBusinessTime(r.clockOut) : "Open"}
                      {r.editReason && (
                        <div
                          className="max-w-[220px] truncate font-sans text-[11px] text-muted-foreground"
                          title={r.editReason}
                        >
                          {r.editReason}
                        </div>
                      )}
                      {r.approvalStatus === "REJECTED" && r.approvalNotes && (
                        <div
                          className="max-w-[220px] truncate font-sans text-[11px] text-destructive"
                          title={r.approvalNotes}
                        >
                          {r.approvalNotes}
                        </div>
                      )}
                    </td>
                    <td className={cn(hoursTdClass, "text-right font-mono text-xs tabular-nums")}>
                      {formatHours(r.totalBreakMin)}
                    </td>
                    <td className={cn(hoursTdClass, "text-right font-mono tabular-nums")}>
                      {r.isOpen ? "—" : formatHours(r.totalWorkMin)}
                    </td>
                    <td className={hoursTdClass}><span className="block max-w-40 truncate" title={r.agencyName}>{r.agencyName}</span></td>
                    <td className={hoursTdClass}>
                      <PunchPhotos
                        type="contract"
                        entryId={r.id}
                        hasIn={r.hasClockInPhoto}
                        hasOut={r.hasClockOutPhoto}
                        source={r.fromKiosk ? "KIOSK" : null}
                        clockIn={r.clockIn}
                        clockOut={r.clockOut}
                      />
                    </td>
                    <td className={hoursTdClass}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ApprovalBadge status={r.approvalStatus} open={r.isOpen} />
                        {r.autoClosed && (
                          <Badge variant="destructive" className="text-[10px]">
                            Auto-closed
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className={hoursTdClass}>
                      <div className="flex justify-end gap-1">
                        {canReview(r) && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => approve([r.id])}
                              aria-label={`Approve entry for ${r.workerName}`}
                            >
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => {
                                setRejectNotes("");
                                setRejectIds([r.id]);
                              }}
                              aria-label={`Reject entry for ${r.workerName}`}
                            >
                              <X className="mr-1 h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </>
                        )}
                        <ContractEntryRowActions
                          entry={{
                            id: r.id,
                            workerName: r.workerName,
                            clockIn: r.clockIn,
                            clockOut: r.clockOut,
                            isOpen: r.isOpen,
                          }}
                          panelSlotId={`hours-${r.id}`}
                        />
                      </div>
                    </td>
                  </tr>
                  <PanelSlotRow id={`hours-${r.id}`} colSpan={11} />
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        }
      />

      <InlinePanel
        open={rejectIds !== null}
        onOpenChange={(v) => !pending && !v && setRejectIds(null)}
      >
        <InlinePanelContent panelSlot={rejectIds?.length === 1 ? `hours-${rejectIds[0]}` : undefined}>
          <InlinePanelHeader>
            <InlinePanelTitle>
              Reject {rejectIds?.length ?? 0}{" "}
              {rejectIds?.length === 1 ? "entry" : "entries"}?
            </InlinePanelTitle>
            <InlinePanelDescription>
              Rejected hours are not counted in the totals or the CSV. A note is required.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="space-y-1">
            <Label htmlFor="cw-reject-notes">Reason</Label>
            <Textarea
              id="cw-reject-notes"
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              maxLength={1000}
            />
          </div>
          <InlinePanelFooter>
            <Button
              variant="outline"
              onClick={() => setRejectIds(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={reject}
              disabled={pending || !rejectNotes.trim()}
            >
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Reject
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>

    </>
  );
}
