"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Download, Loader2, PenLine, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PunchPhotos } from "@/components/punch-photos";
import { toastAction } from "@/lib/toast-action";
import { formatBusinessTime, formatDateOnly, formatHours } from "@/lib/format";
import { dateToBusinessLocal } from "@/lib/time-rules";
import {
  adminEditContractTimeEntry,
  bulkReviewContractTimeEntries,
  reviewContractTimeEntry,
} from "@/server/actions/contract-workers";
import { exportContractHoursCsv } from "./export-actions";
import { ApprovalBadge, type HoursRow } from "./shared";

const canReview = (r: HoursRow) => !r.isOpen && r.clockOut !== null && r.approvalStatus === "PENDING";

export function DownloadHoursCsvButton({
  from,
  to,
  agencyId,
}: {
  from: string;
  to: string;
  agencyId: string;
}) {
  const [pending, startTransition] = useTransition();
  function download() {
    startTransition(async () => {
      const res = await exportContractHoursCsv({ from, to, agencyId: agencyId || undefined });
      if (!toastAction(res)) return;
      // Header row only: nothing to export.
      if (!res.csv.includes("\n")) {
        toast.info("No entries in this range, so there is nothing to export.");
        return;
      }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contract-hours-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    });
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={download} disabled={pending}>
      {pending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="mr-1.5 h-3.5 w-3.5" />
      )}
      Download CSV
    </Button>
  );
}

export function HoursTable({ rows }: { rows: HoursRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectIds, setRejectIds] = useState<string[] | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [editRow, setEditRow] = useState<HoursRow | null>(null);
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [reason, setReason] = useState("");

  const reviewable = rows.filter(canReview);
  // Drop selections that are no longer reviewable after a refresh.
  const activeSelected = reviewable.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = reviewable.length > 0 && activeSelected.length === reviewable.length;

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
        const res = await reviewContractTimeEntry({ id: ids[0]!, decision: "APPROVED" });
        if (!toastAction(res)) return;
        toast.success("Entry approved");
      } else {
        const res = await bulkReviewContractTimeEntries({ ids, decision: "APPROVED" });
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
        const res = await reviewContractTimeEntry({ id: ids[0]!, decision: "REJECTED", notes });
        if (!toastAction(res)) return;
        toast.success("Entry rejected");
      } else {
        const res = await bulkReviewContractTimeEntries({ ids, decision: "REJECTED", notes });
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

  function openEdit(r: HoursRow) {
    setEditRow(r);
    setClockIn(dateToBusinessLocal(new Date(r.clockIn)));
    setClockOut(r.clockOut ? dateToBusinessLocal(new Date(r.clockOut)) : "");
    setReason("");
  }

  function saveEdit() {
    if (!editRow) return;
    if (!clockIn || !clockOut) return toast.error("Enter both clock-in and clock-out.");
    if (reason.trim().length < 3) return toast.error("Enter a reason (at least 3 characters).");
    startTransition(async () => {
      const res = await adminEditContractTimeEntry({
        id: editRow.id,
        clockIn,
        clockOut,
        reason: reason.trim(),
      });
      if (!toastAction(res)) return;
      toast.success("Times updated. The entry is pending approval again.");
      setEditRow(null);
      router.refresh();
    });
  }

  if (rows.length === 0)
    return <p className="py-10 text-center text-sm text-muted-foreground">No entries in this range.</p>;

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
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="w-10 p-3">
                <Checkbox
                  aria-label="Select all pending entries"
                  disabled={reviewable.length === 0}
                  checked={allSelected}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(reviewable.map((r) => r.id)) : new Set())}
                />
              </th>
              <th className="p-3 font-medium">Date</th>
              <th className="p-3 font-medium">Worker</th>
              <th className="p-3 font-medium">Agency</th>
              <th className="p-3 font-medium">Times</th>
              <th className="p-3 text-right font-medium">Breaks</th>
              <th className="p-3 text-right font-medium">Work</th>
              <th className="p-3 font-medium">Photos</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b align-middle last:border-0">
                <td className="p-3">
                  {canReview(r) && (
                    <Checkbox
                      aria-label={`Select entry for ${r.workerName}`}
                      checked={selected.has(r.id)}
                      onCheckedChange={(v) => toggle(r.id, v === true)}
                    />
                  )}
                </td>
                <td className="whitespace-nowrap p-3 text-xs">{formatDateOnly(r.date)}</td>
                <td className="p-3">
                  <Link href={`/admin/contract-workers/${r.workerDbId}`} className="font-medium hover:underline">
                    {r.workerName}
                  </Link>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {r.workerCode}
                    {r.project ? ` · ${r.project}` : ""}
                  </div>
                </td>
                <td className="p-3">{r.agencyName}</td>
                <td className="whitespace-nowrap p-3 font-mono text-xs">
                  {formatBusinessTime(r.clockIn)}
                  {r.clockOut ? ` → ${formatBusinessTime(r.clockOut)}` : " → open"}
                  {r.editReason && (
                    <div className="max-w-[220px] truncate font-sans text-[11px] text-muted-foreground" title={r.editReason}>
                      {r.editReason}
                    </div>
                  )}
                  {r.approvalStatus === "REJECTED" && r.approvalNotes && (
                    <div className="max-w-[220px] truncate font-sans text-[11px] text-destructive" title={r.approvalNotes}>
                      {r.approvalNotes}
                    </div>
                  )}
                </td>
                <td className="p-3 text-right font-mono text-xs tabular-nums">{formatHours(r.totalBreakMin)}</td>
                <td className="p-3 text-right font-mono tabular-nums">{r.isOpen ? "—" : formatHours(r.totalWorkMin)}</td>
                <td className="p-3">
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
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ApprovalBadge status={r.approvalStatus} open={r.isOpen} />
                    {r.autoClosed && (
                      <Badge variant="destructive" className="text-[10px]">
                        Auto-closed
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="p-3">
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
                    {!r.isOpen && r.clockOut && (
                      <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                        <PenLine className="mr-1 h-3.5 w-3.5" />
                        Edit times
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={rejectIds !== null} onOpenChange={(v) => !v && setRejectIds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reject {rejectIds?.length ?? 0} {rejectIds?.length === 1 ? "entry" : "entries"}?
            </DialogTitle>
            <DialogDescription>
              Rejected hours are not counted in the totals or the CSV. A note is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="cw-reject-notes">Reason</Label>
            <Textarea
              id="cw-reject-notes"
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              maxLength={1000}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectIds(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={reject} disabled={pending || !rejectNotes.trim()}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editRow !== null} onOpenChange={(v) => !v && setEditRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit times for {editRow?.workerName}</DialogTitle>
            <DialogDescription>
              Times are Central. Breaks are kept. After saving, the entry is pending approval again.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cw-edit-in">Clock in</Label>
              <Input
                id="cw-edit-in"
                type="datetime-local"
                value={clockIn}
                onChange={(e) => setClockIn(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cw-edit-out">Clock out</Label>
              <Input
                id="cw-edit-out"
                type="datetime-local"
                value={clockOut}
                onChange={(e) => setClockOut(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="cw-edit-reason">Reason (saved in the audit log)</Label>
              <Textarea
                id="cw-edit-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save times
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
