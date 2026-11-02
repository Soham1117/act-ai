"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, PenLine, Plus, Square, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  InlinePanel,
  InlinePanelCancel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
  PanelSlot,
} from "@/components/inline-panel";
import { InlineConfirmAction } from "@/components/inline-confirm-action";
import { cn } from "@/lib/utils";
import { runAction, toastAction } from "@/lib/toast-action";
import { formatBusinessTime, formatDateOnly, formatHours } from "@/lib/format";
import { ADMIN_MAX_SHIFT_MS, dateToBusinessLocal } from "@/lib/time-rules";
import {
  adminCreateManualTimeEntry,
  adminDeleteTimeEntry,
  adminForceClockOut,
  adminReopenTimeEntry,
  adminUpdateTimeEntry,
} from "@/server/actions/time-admin";
import { bulkReviewTimeEntries, reviewTimeEntry } from "@/server/actions/time-clock";
import { PunchPhotos } from "@/components/punch-photos";
import {
  entryPanelSlotId,
  type EmployeeOption,
  type EntryRowData,
  type JobCodeOption,
} from "./time-types";

const selectClass =
  "flex h-9 w-full min-h-11 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 md:min-h-9";

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
          className="h-7 gap-1 text-xs min-h-11 md:min-h-7"
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
        <div key={b.id ?? `new-${i}`} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            type="datetime-local"
            className="min-h-11 md:min-h-9"
            value={b.start}
            disabled={disabled}
            onChange={(e) => onChange(breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
          />
          <Input
            type="datetime-local"
            className="min-h-11 md:min-h-9"
            value={b.end}
            disabled={disabled}
            onChange={(e) => onChange(breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 md:h-8 md:w-8"
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
// Edit panel (+ reopen / delete)
// ──────────────────────────────────────────────────────────────────────

function EditEntryPanel({
  entry,
  jobCodes,
  onClose,
  panelSlot,
}: {
  entry: EntryRowData;
  jobCodes: JobCodeOption[];
  onClose: () => void;
  panelSlot: string;
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

  function done(message: string) {
    toast.success(message);
    onClose();
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
      const res = await runAction(() => adminUpdateTimeEntry({
        id: entry.id,
        clockIn,
        clockOut: openEntry ? null : clockOut,
        jobCode,
        notes: notes.trim() ? notes : null,
        breaks: openEntry ? undefined : breaks.map((b) => ({ id: b.id, start: b.start, end: b.end })),
        reason: reason.trim(),
      }));
      if (!toastAction(res)) return;
      done(`${res.message} The employee was notified.`);
    });
  }

  function reopen() {
    if (!requireReason()) return;
    startTransition(async () => {
      const res = await runAction(() => adminReopenTimeEntry({ id: entry.id, reason: reason.trim() }));
      if (!toastAction(res)) return;
      done("Entry reopened. The employee is clocked in again.");
    });
  }

  return (
    <InlinePanel open onOpenChange={(o) => !o && onClose()}>
      <InlinePanelContent panelSlot={panelSlot} className="my-2">
        <InlinePanelHeader>
          <InlinePanelTitle>Edit time entry</InlinePanelTitle>
          <InlinePanelDescription>
            {entry.employeeName} · {formatDateOnly(entry.date)}. All times are Central.
            {entry.approvalStatus === "APPROVED" &&
              " This entry is approved; it stays approved, and the edit is recorded."}
          </InlinePanelDescription>
        </InlinePanelHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Clock in</Label>
              <Input
                type="datetime-local"
                className="min-h-11 md:min-h-9"
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
                  className="min-h-11 md:min-h-9"
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
              className="min-h-11 md:min-h-9"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Employee forgot to clock out; confirmed with supervisor"
            />
          </div>
          <InlinePanelFooter className="sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {!openEntry && (
                <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-9" disabled={pending} onClick={reopen}>
                  <Undo2 className="mr-1 h-3.5 w-3.5" /> Reopen
                </Button>
              )}
              <InlineConfirmAction
                label="Delete entry"
                message={`The entry and its breaks are permanently removed from ${entry.employeeName}'s timesheet. A full copy is kept in the audit log with your reason.`}
                cancelLabel="Cancel"
                variant="destructive"
                className="h-8 gap-1 text-xs min-h-11 md:min-h-9"
                onConfirm={async () => {
                  if (reason.trim().length < 3) {
                    toast.error("Enter a reason for this change. It is audited and shown to the employee.");
                    return false;
                  }
                  const res = await runAction(() =>
                    adminDeleteTimeEntry({ id: entry.id, reason: reason.trim() }),
                  );
                  if (!toastAction(res)) return false;
                  done("Entry deleted.");
                  return true;
                }}
              >
                <>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </>
              </InlineConfirmAction>
            </div>
            <div className="flex flex-wrap gap-2">
              <InlinePanelCancel disabled={pending}>Cancel</InlinePanelCancel>
              <Button type="submit" className="min-h-11 md:min-h-9" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </div>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Force clock-out panel
// ──────────────────────────────────────────────────────────────────────

function ForceClockOutPanel({
  entry,
  onClose,
  panelSlot,
}: {
  entry: EntryRowData;
  onClose: () => void;
  panelSlot: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const capMs = new Date(entry.clockIn).getTime() + ADMIN_MAX_SHIFT_MS;
  const [clockOut, setClockOut] = useState(() =>
    dateToBusinessLocal(new Date(Math.min(Date.now(), capMs))),
  );
  const [reason, setReason] = useState(entry.autoClosed ? "" : "Forgot to clock out");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await runAction(() => adminForceClockOut({ id: entry.id, clockOut, reason: reason.trim() }));
      if (!toastAction(res)) return;
      toast.success("Clocked out. The entry is now pending approval.");
      onClose();
      router.refresh();
    });
  }

  return (
    <InlinePanel open onOpenChange={(o) => !o && onClose()}>
      <InlinePanelContent panelSlot={panelSlot} className="my-2">
        <InlinePanelHeader>
          <InlinePanelTitle>Force clock-out</InlinePanelTitle>
          <InlinePanelDescription>
            {entry.employeeName} clocked in {formatDateOnly(entry.date)} at{" "}
            {formatBusinessTime(entry.clockIn)}. Choose when their shift really ended (up to 24
            hours after clock-in, Central time). Any open break is closed at that time.
          </InlinePanelDescription>
        </InlinePanelHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Clock out</Label>
            <Input
              type="datetime-local"
              className="min-h-11 md:min-h-9"
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
            <Input
              className="min-h-11 md:min-h-9"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <InlinePanelFooter>
            <InlinePanelCancel disabled={pending}>Cancel</InlinePanelCancel>
            <Button type="submit" className="min-h-11 md:min-h-9" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Clock out
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}

/** Edit (+ force clock-out for open shifts) buttons for one entry row.
 *  Call sites must render a PanelSlot / PanelSlotRow with id entryPanelSlotId(entry.id)
 *  or the form collapses into the actions cell. */
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
  const panelSlot = entryPanelSlotId(entry.id);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {isOpen(entry) && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs min-h-11 md:min-h-8"
          onClick={() => {
            setEditOpen(false);
            setForceOpen(true);
          }}
        >
          <Square className="h-3 w-3" />
          {compact ? "" : "Force clock-out"}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-8 gap-1 text-xs min-h-11 md:min-h-8"
        aria-label={`Edit time entry for ${entry.employeeName}`}
        onClick={() => {
          setForceOpen(false);
          setEditOpen(true);
        }}
      >
        <PenLine className="h-3 w-3" />
        {compact ? "" : "Edit"}
      </Button>
      {editOpen && (
        <EditEntryPanel
          entry={entry}
          jobCodes={jobCodes}
          panelSlot={panelSlot}
          onClose={() => setEditOpen(false)}
        />
      )}
      {forceOpen && (
        <ForceClockOutPanel
          entry={entry}
          panelSlot={panelSlot}
          onClose={() => setForceOpen(false)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Manual entry
// ──────────────────────────────────────────────────────────────────────

export function ManualEntryButton({
  employees,
  jobCodes,
  fixedEmployeeId,
}: {
  employees: EmployeeOption[];
  jobCodes: JobCodeOption[];
  /** When set (Individual hours for one person), skip the employee picker. */
  fixedEmployeeId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const formId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [employeeId, setEmployeeId] = useState(fixedEmployeeId ?? "");
  const [search, setSearch] = useState("");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [jobCode, setJobCode] = useState(jobCodes[0]?.code ?? "");
  const [notes, setNotes] = useState("");
  const [breaks, setBreaks] = useState<BreakDraft[]>([]);
  const [reason, setReason] = useState("");
  const [approve, setApprove] = useState(false);

  useEffect(() => {
    if (fixedEmployeeId) setEmployeeId(fixedEmployeeId);
  }, [fixedEmployeeId]);

  useEffect(() => {
    if (!open && !pending && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open, pending]);

  function closeForm() {
    restoreFocus.current = true;
    setOpen(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) => e.name.toLowerCase().includes(q) || e.employeeId.toLowerCase().includes(q),
    );
  }, [employees, search]);

  const lockedEmployee = fixedEmployeeId
    ? employees.find((e) => e.id === fixedEmployeeId) ?? null
    : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = fixedEmployeeId || employeeId;
    if (!id) {
      toast.error("Choose an employee.");
      return;
    }
    if (!clockIn || !clockOut) {
      toast.error("Enter clock-in and clock-out times.");
      return;
    }
    startTransition(async () => {
      const res = await runAction(() => adminCreateManualTimeEntry({
        employeeId: id,
        clockIn,
        clockOut,
        jobCode,
        notes: notes.trim() ? notes : null,
        breaks: breaks.map((b) => ({ start: b.start, end: b.end })),
        reason: reason.trim(),
        approve,
      }));
      if (!toastAction(res)) return;
      toast.success(approve ? "Manual entry added and approved." : "Manual entry added (pending approval).");
      closeForm();
      setClockIn("");
      setClockOut("");
      setBreaks([]);
      setReason("");
      setNotes("");
      router.refresh();
    });
  }

  return (
    <Collapsible
      className="w-full min-w-0 space-y-3"
      open={open}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger asChild disabled={pending}>
        <Button ref={triggerRef} size="sm" className="min-h-11 w-full sm:w-auto md:min-h-9">
          <Plus className="mr-1 h-3.5 w-3.5" /> Add entry
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <section
          aria-labelledby={`${formId}-heading`}
          className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-6"
        >
          <div className="space-y-1.5">
            <h2 id={`${formId}-heading`} className="text-lg font-semibold">
              Add manual time entry
            </h2>
            <p className="text-sm text-muted-foreground">
              For missed punches. The entry is marked Manual. Times are Central.
            </p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            {fixedEmployeeId ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Employee</Label>
                <p className="text-sm font-medium">
                  {lockedEmployee
                    ? `${lockedEmployee.name} · ${lockedEmployee.employeeId}`
                    : "Selected employee"}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Employee</Label>
                <Input
                  className="min-h-11 md:min-h-9"
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
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor={`${formId}-in`}>
                  Clock in
                </Label>
                <Input
                  id={`${formId}-in`}
                  type="datetime-local"
                  className="min-h-11 md:min-h-9"
                  value={clockIn}
                  onChange={(e) => setClockIn(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor={`${formId}-out`}>
                  Clock out
                </Label>
                <Input
                  id={`${formId}-out`}
                  type="datetime-local"
                  className="min-h-11 md:min-h-9"
                  value={clockOut}
                  onChange={(e) => setClockOut(e.target.value)}
                  required
                />
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
                className="min-h-11 md:min-h-9"
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
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&_button]:min-h-11 md:[&_button]:min-h-9">
              <Button type="button" variant="outline" disabled={pending} onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add entry
              </Button>
            </div>
          </form>
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Pending queue with bulk approve
// ──────────────────────────────────────────────────────────────────────

function RejectPanel({
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
    <InlinePanel open={open} onOpenChange={onOpenChange}>
      <InlinePanelContent className="my-2">
        <InlinePanelHeader>
          <InlinePanelTitle>{title}</InlinePanelTitle>
          <InlinePanelDescription>{description}</InlinePanelDescription>
        </InlinePanelHeader>
        <div className="space-y-1.5">
          <Label className="text-xs">Reason (shown to the employee)</Label>
          <Textarea rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
        </div>
        <InlinePanelFooter>
          <InlinePanelCancel disabled={pending}>Cancel</InlinePanelCancel>
          <Button
            variant="destructive"
            className="min-h-11 md:min-h-9"
            disabled={pending || reason.trim().length < 3}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reject
          </Button>
        </InlinePanelFooter>
      </InlinePanelContent>
    </InlinePanel>
  );
}

function RowReview({ entry }: { entry: EntryRowData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);

  function run(decision: "APPROVED" | "REJECTED", notes?: string) {
    startTransition(async () => {
      const res = await runAction(() => reviewTimeEntry({ timeEntryId: entry.id, decision, notes }));
      if (!toastAction(res)) return;
      toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
      setRejectOpen(false);
      router.refresh();
    });
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="destructive"
        className="min-h-11 md:min-h-9"
        disabled={pending}
        onClick={() => setRejectOpen(true)}
        aria-label="Reject"
      >
        <X className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="success" className="min-h-11 md:min-h-9" disabled={pending} onClick={() => run("APPROVED")}>
        <Check className="h-4 w-4" /> Approve
      </Button>
      {rejectOpen && (
        <RejectPanel
          title="Reject time entry"
          description={`${entry.employeeName}, ${formatDateOnly(entry.date)} (${formatHours(entry.totalWorkMin)}).`}
          open={rejectOpen}
          onOpenChange={setRejectOpen}
          pending={pending}
          onConfirm={(reason) => run("REJECTED", reason)}
        />
      )}
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
      const res = await runAction(() => bulkReviewTimeEntries({ ids: [...selected], decision, notes }));
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
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="destructive"
            className="min-h-11 md:min-h-9"
            disabled={pending || selected.size === 0}
            onClick={() => setBulkReject(true)}
          >
            Reject selected
          </Button>
          <Button
            size="sm"
            variant="success"
            className="min-h-11 md:min-h-9"
            disabled={pending || selected.size === 0}
            onClick={() => bulk("APPROVED")}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Check className="h-4 w-4" /> Approve selected
          </Button>
        </div>
      </div>
      {bulkReject && (
        <div className="border-b px-3 pb-3">
          <RejectPanel
            title={`Reject ${selected.size} entries`}
            description="The same reason is sent to each employee."
            open={bulkReject}
            onOpenChange={setBulkReject}
            pending={pending}
            onConfirm={(reason) => bulk("REJECTED", reason)}
          />
        </div>
      )}
      <ul className="divide-y">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Checkbox
                className="mt-2"
                checked={selected.has(e.id)}
                onCheckedChange={() => toggle(e.id)}
                aria-label={`Select ${e.employeeName}`}
              />
              <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted">
                <Image src={e.avatar} alt={e.employeeName} fill sizes="36px" className="object-cover" unoptimized />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{e.employeeName}</p>
                <p className="break-words text-[11px] text-muted-foreground">
                  {formatDateOnly(e.date)} · {formatBusinessTime(e.clockIn)} to {formatBusinessTime(e.clockOut)} ·{" "}
                  {e.jobCode} · {formatHours(e.totalWorkMin)}
                  {e.totalBreakMin > 0 && ` (breaks ${formatHours(e.totalBreakMin)})`}
                </p>
                {e.autoClosed && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-destructive">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> Auto-closed at the 16 hour cap. Verify the hours.
                  </p>
                )}
                {e.editReason && !e.autoClosed && (
                  <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{e.editReason}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-12 sm:pl-0">
              <PunchPhotos
                type="employee"
                entryId={e.id}
                hasIn={e.hasClockInPhoto}
                hasOut={e.hasClockOutPhoto}
                source={e.source}
                clockIn={e.clockIn}
                clockOut={e.clockOut}
              />
              {e.source === "MANUAL" && <Badge variant="outline" className="text-[10px]">Manual</Badge>}
              <EntryActions entry={e} jobCodes={jobCodes} compact />
              <RowReview entry={e} />
            </div>
            <PanelSlot id={entryPanelSlotId(e.id)} className="w-full basis-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}
