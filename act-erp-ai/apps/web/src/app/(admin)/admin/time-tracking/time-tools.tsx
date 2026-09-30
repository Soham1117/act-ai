"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, PenLine, Plus, Square, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toastAction } from "@/lib/toast-action";
import { formatBusinessTime, formatDateOnly, formatHours } from "@/lib/format";
import { dateToBusinessLocal, MAX_SHIFT_MS } from "@/lib/time-rules";
import {
  adminCreateManualTimeEntry,
  adminDeleteTimeEntry,
  adminForceClockOut,
  adminReopenTimeEntry,
  adminUpdateTimeEntry,
} from "@/server/actions/time-admin";
import { bulkReviewTimeEntries, reviewTimeEntry } from "@/server/actions/time-clock";
import type { EmployeeOption, EntryRowData, JobCodeOption } from "./time-types";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const isOpen = (e: { status: string }) => e.status === "ACTIVE" || e.status === "ON_BREAK";

type BreakDraft = { id?: string; start: string; end: string };

function JobCodeSelect({
  value,
  onChange,
  jobCodes,
}: {
  value: string;
  onChange: (v: string) => void;
  jobCodes: JobCodeOption[];
}) {
  const options = jobCodes.some((j) => j.code === value)
    ? jobCodes
    : [{ code: value, title: "current" }, ...jobCodes];
  return (
    <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((j) => (
        <option key={j.code} value={j.code}>
          {j.code} {j.title ? `· ${j.title}` : ""}
        </option>
      ))}
    </select>
  );
}

function BreakEditor({
  breaks,
  onChange,
  disabled,
}: {
  breaks: BreakDraft[];
  onChange: (b: BreakDraft[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Breaks (Central time)</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={disabled}
          onClick={() => onChange([...breaks, { start: "", end: "" }])}
        >
          <Plus className="h-3 w-3" /> Add break
        </Button>
      </div>
      {breaks.length === 0 && (
        <p className="text-xs text-muted-foreground">No breaks recorded.</p>
      )}
      {breaks.map((b, i) => (
        <div key={b.id ?? `new-${i}`} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Input
            type="datetime-local"
            value={b.start}
            disabled={disabled}
            onChange={(e) => onChange(breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
          />
          <Input
            type="datetime-local"
            value={b.end}
            disabled={disabled}
            onChange={(e) => onChange(breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={disabled}
            aria-label="Remove break"
            onClick={() => onChange(breaks.filter((_, j) => j !== i))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Edit dialog (+ reopen / delete)
// ──────────────────────────────────────────────────────────────────────

function EditEntryDialog({
  entry,
  jobCodes,
  open,
  onOpenChange,
}: {
  entry: EntryRowData;
  jobCodes: JobCodeOption[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const openEntry = isOpen(entry);
  const [clockIn, setClockIn] = useState(() => dateToBusinessLocal(new Date(entry.clockIn)));
  const [clockOut, setClockOut] = useState(() =>
    entry.clockOut ? dateToBusinessLocal(new Date(entry.clockOut)) : "",
  );
  const [jobCode, setJobCode] = useState(entry.jobCode);
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [breaks, setBreaks] = useState<BreakDraft[]>(() =>
    entry.breaks.map((b) => ({
      id: b.id,
      start: dateToBusinessLocal(new Date(b.start)),
      end: b.end ? dateToBusinessLocal(new Date(b.end)) : "",
    })),
  );
  const [reason, setReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  function done(message: string) {
    toast.success(message);
    onOpenChange(false);
    router.refresh();
  }

  function requireReason() {
    if (reason.trim().length < 3) {
      toast.error("Enter a reason for this change. It is audited and shown to the employee.");
      return false;
    }
    return true;
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!requireReason()) return;
    startTransition(async () => {
      const res = await adminUpdateTimeEntry({
        id: entry.id,
        clockIn,
        clockOut: openEntry ? null : clockOut,
        jobCode,
        notes: notes.trim() ? notes : null,
        breaks: openEntry ? undefined : breaks.map((b) => ({ id: b.id, start: b.start, end: b.end })),
        reason: reason.trim(),
      });
      if (!toastAction(res)) return;
      done("Time entry updated. The employee was notified.");
    });
  }

  function reopen() {
    if (!requireReason()) return;
    startTransition(async () => {
      const res = await adminReopenTimeEntry({ id: entry.id, reason: reason.trim() });
      if (!toastAction(res)) return;
      done("Entry reopened. The employee is clocked in again.");
    });
  }

  function remove() {
    if (!requireReason()) {
      setConfirmDelete(false);
      return;
    }
    startTransition(async () => {
      const res = await adminDeleteTimeEntry({ id: entry.id, reason: reason.trim() });
      setConfirmDelete(false);
      if (!toastAction(res)) return;
      done("Entry deleted.");
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit time entry</DialogTitle>
            <DialogDescription>
              {entry.employeeName} · {formatDateOnly(entry.date)}. All times are Central.
              {entry.approvalStatus === "APPROVED" &&
                " This entry is approved; it stays approved, and the edit is recorded."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Clock in</Label>
                <Input
                  type="datetime-local"
                  value={clockIn}
                  onChange={(e) => setClockIn(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Clock out</Label>
                {openEntry ? (
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Still on shift. Use Force clock-out to close it.
                  </p>
                ) : (
                  <Input
                    type="datetime-local"
                    value={clockOut}
                    onChange={(e) => setClockOut(e.target.value)}
                    required
                  />
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Job code</Label>
              <JobCodeSelect value={jobCode} onChange={setJobCode} jobCodes={jobCodes} />
            </div>
            {!openEntry && <BreakEditor breaks={breaks} onChange={setBreaks} disabled={pending} />}
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason for change (required)</Label>
              <Input
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Employee forgot to clock out; confirmed with supervisor"
              />
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <div className="flex gap-2">
                {!openEntry && (
                  <Button type="button" variant="outline" size="sm" disabled={pending} onClick={reopen}>
                    <Undo2 className="mr-1 h-3.5 w-3.5" /> Reopen
                  </Button>
                )}
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (requireReason()) setConfirmDelete(true);
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this time entry?</AlertDialogTitle>
            <AlertDialogDescription>
              The entry and its breaks are permanently removed from {entry.employeeName}&apos;s timesheet.
              A full copy is kept in the audit log with your reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
            >
              Delete entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Force clock-out dialog
// ──────────────────────────────────────────────────────────────────────

function ForceClockOutDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: EntryRowData;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const capMs = new Date(entry.clockIn).getTime() + MAX_SHIFT_MS;
  const [clockOut, setClockOut] = useState(() =>
    dateToBusinessLocal(new Date(Math.min(Date.now(), capMs))),
  );
  const [reason, setReason] = useState(entry.autoClosed ? "" : "Forgot to clock out");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await adminForceClockOut({ id: entry.id, clockOut, reason: reason.trim() });
      if (!toastAction(res)) return;
      toast.success("Clocked out. The entry is now pending approval.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Force clock-out</DialogTitle>
          <DialogDescription>
            {entry.employeeName} clocked in {formatDateOnly(entry.date)} at{" "}
            {formatBusinessTime(entry.clockIn)}. Choose when their shift really ended (no more
            than 16 hours after clock-in, Central time). Any open break is closed at that time.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Clock out</Label>
            <Input
              type="datetime-local"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Latest allowed: {formatBusinessTime(new Date(capMs))} on{" "}
              {formatDateOnly(dateToBusinessLocal(new Date(capMs)).slice(0, 10))}.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason (required)</Label>
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Clock out
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Edit (+ force clock-out for open shifts) buttons for one entry row. */
export function EntryActions({
  entry,
  jobCodes,
  compact,
}: {
  entry: EntryRowData;
  jobCodes: JobCodeOption[];
  compact?: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [forceOpen, setForceOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      {isOpen(entry) && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs"
          onClick={() => setForceOpen(true)}
        >
          <Square className="h-3 w-3" />
          {compact ? "" : "Force clock-out"}
        </Button>
      )}
      <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setEditOpen(true)}>
        <PenLine className="h-3 w-3" />
        {compact ? "" : "Edit"}
      </Button>
      {editOpen && (
        <EditEntryDialog entry={entry} jobCodes={jobCodes} open={editOpen} onOpenChange={setEditOpen} />
      )}
      {forceOpen && <ForceClockOutDialog entry={entry} open={forceOpen} onOpenChange={setForceOpen} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Manual entry
// ──────────────────────────────────────────────────────────────────────

export function ManualEntryButton({
  employees,
  jobCodes,
}: {
  employees: EmployeeOption[];
  jobCodes: JobCodeOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState("");
  const [search, setSearch] = useState("");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [jobCode, setJobCode] = useState(jobCodes[0]?.code ?? "");
  const [notes, setNotes] = useState("");
  const [breaks, setBreaks] = useState<BreakDraft[]>([]);
  const [reason, setReason] = useState("");
  const [approve, setApprove] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) => e.name.toLowerCase().includes(q) || e.employeeId.toLowerCase().includes(q),
    );
  }, [employees, search]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) {
      toast.error("Choose an employee.");
      return;
    }
    startTransition(async () => {
      const res = await adminCreateManualTimeEntry({
        employeeId,
        clockIn,
        clockOut,
        jobCode,
        notes: notes.trim() ? notes : null,
        breaks: breaks.map((b) => ({ start: b.start, end: b.end })),
        reason: reason.trim(),
        approve,
      });
      if (!toastAction(res)) return;
      toast.success(approve ? "Manual entry added and approved." : "Manual entry added (pending approval).");
      setOpen(false);
      setClockIn("");
      setClockOut("");
      setBreaks([]);
      setReason("");
      setNotes("");
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add manual entry
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add manual time entry</DialogTitle>
            <DialogDescription>
              For missed punches. The entry is marked Manual. Times are Central.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Employee</Label>
              <Input
                placeholder="Search by name or ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className={selectClass}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                size={Math.min(6, Math.max(2, filtered.length))}
                style={{ height: "auto" }}
              >
                {filtered.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.employeeId}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Clock in</Label>
                <Input type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Clock out</Label>
                <Input type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Job code</Label>
              <JobCodeSelect value={jobCode} onChange={setJobCode} jobCodes={jobCodes} />
            </div>
            <BreakEditor breaks={breaks} onChange={setBreaks} disabled={pending} />
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason (required)</Label>
              <Input
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Kiosk was offline; hours confirmed by supervisor"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={approve} onCheckedChange={(v) => setApprove(v === true)} />
              Approve immediately
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add entry
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Pending queue with bulk approve
// ──────────────────────────────────────────────────────────────────────

function RejectDialog({
  title,
  description,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs">Reason (shown to the employee)</Label>
          <Textarea rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || reason.trim().length < 3}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RowReview({ entry }: { entry: EntryRowData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);

  function run(decision: "APPROVED" | "REJECTED", notes?: string) {
    startTransition(async () => {
      const res = await reviewTimeEntry({ timeEntryId: entry.id, decision, notes });
      if (!toastAction(res)) return;
      toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
      setRejectOpen(false);
      router.refresh();
    });
  }
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => setRejectOpen(true)} aria-label="Reject">
        <X className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="success" disabled={pending} onClick={() => run("APPROVED")}>
        <Check className="h-4 w-4" /> Approve
      </Button>
      <RejectDialog
        title="Reject time entry"
        description={`${entry.employeeName}, ${formatDateOnly(entry.date)} (${formatHours(entry.totalWorkMin)}).`}
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        pending={pending}
        onConfirm={(reason) => run("REJECTED", reason)}
      />
    </div>
  );
}

export function PendingQueue({
  entries,
  jobCodes,
}: {
  entries: EntryRowData[];
  jobCodes: JobCodeOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [bulkReject, setBulkReject] = useState(false);

  const allSelected = entries.length > 0 && entries.every((e) => selected.has(e.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulk(decision: "APPROVED" | "REJECTED", notes?: string) {
    startTransition(async () => {
      const res = await bulkReviewTimeEntries({ ids: [...selected], decision, notes });
      if (!toastAction(res)) return;
      toast.success(
        `${res.updated} ${decision === "APPROVED" ? "approved" : "rejected"}` +
          (res.skipped ? ` (${res.skipped} skipped: no longer pending)` : ""),
      );
      setSelected(new Set());
      setBulkReject(false);
      router.refresh();
    });
  }

  if (entries.length === 0) {
    return (
      <div className="grid h-32 place-items-center text-xs text-muted-foreground">
        Inbox zero. Nothing pending.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b p-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(v) =>
              setSelected(v === true ? new Set(entries.map((e) => e.id)) : new Set())
            }
          />
          Select all on this page
        </label>
        <span className="text-xs text-muted-foreground">{selected.size} selected</span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={pending || selected.size === 0}
            onClick={() => setBulkReject(true)}
          >
            Reject selected
          </Button>
          <Button
            size="sm"
            variant="success"
            disabled={pending || selected.size === 0}
            onClick={() => bulk("APPROVED")}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Check className="h-4 w-4" /> Approve selected
          </Button>
        </div>
      </div>
      <ul className="divide-y">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-3 p-3">
            <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggle(e.id)} aria-label="Select entry" />
            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted">
              <Image src={e.avatar} alt={e.employeeName} fill sizes="36px" className="object-cover" unoptimized />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{e.employeeName}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {formatDateOnly(e.date)} · {formatBusinessTime(e.clockIn)} to {formatBusinessTime(e.clockOut)} ·{" "}
                {e.jobCode} · {formatHours(e.totalWorkMin)}
                {e.totalBreakMin > 0 && ` (breaks ${formatHours(e.totalBreakMin)})`}
              </p>
              {e.autoClosed && (
                <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-destructive">
                  <AlertTriangle className="h-3 w-3" /> Auto-closed at the 16 hour cap. Verify the hours.
                </p>
              )}
              {e.editReason && !e.autoClosed && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{e.editReason}</p>
              )}
            </div>
            {e.source === "MANUAL" && <Badge variant="outline" className="text-[10px]">Manual</Badge>}
            <EntryActions entry={e} jobCodes={jobCodes} compact />
            <RowReview entry={e} />
          </li>
        ))}
      </ul>
      <RejectDialog
        title={`Reject ${selected.size} entries`}
        description="The same reason is sent to each employee."
        open={bulkReject}
        onOpenChange={setBulkReject}
        pending={pending}
        onConfirm={(reason) => bulk("REJECTED", reason)}
      />
    </div>
  );
}
