"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SimpleSelect } from "@/components/simple-select";
import {
  proposeContractAssignmentOffers,
  type ContractAssignmentOffers,
} from "@/lib/contract-workers";
import { parseDateOnly } from "@/lib/time-rules";
import { runAction, toastAction } from "@/lib/toast-action";
import { cn } from "@/lib/utils";
import { adminCreateManualContractTimeEntry } from "@/server/actions/contract-workers";

export type ContractEntryWorkerOption = {
  id: string;
  name: string;
  workerId: string;
  jobCode: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string | null;
  status: "ACTIVE" | "INACTIVE" | "ENDED";
};

type JobCodeOption = { code: string; title: string };

function toDateOnly(isoOrYmd: string): Date {
  const ymd = isoOrYmd.slice(0, 10);
  return parseDateOnly(ymd) ?? new Date(`${ymd}T00:00:00.000Z`);
}

function buildOffers(
  accepted: { shiftStart: boolean; extendEnd: boolean; reactivate: boolean },
  proposed: ContractAssignmentOffers,
): ContractAssignmentOffers {
  const out: ContractAssignmentOffers = {};
  if (accepted.shiftStart && proposed.shiftStartTo) out.shiftStartTo = proposed.shiftStartTo;
  if (accepted.extendEnd && proposed.extendEndTo) out.extendEndTo = proposed.extendEndTo;
  if (accepted.reactivate && proposed.reactivate) out.reactivate = true;
  return out;
}

/** In-page collapsible — same pattern as employee “Add manual entry”. Never a side drawer. */
export function AddContractEntryButton({
  workers,
  jobCodes,
  fixedWorkerId,
  label = "Add entry",
  className,
}: {
  workers: ContractEntryWorkerOption[];
  jobCodes: JobCodeOption[];
  fixedWorkerId?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [workerId, setWorkerId] = useState(fixedWorkerId ?? workers[0]?.id ?? "");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [jobCode, setJobCode] = useState(
    () => workers.find((w) => w.id === (fixedWorkerId ?? workers[0]?.id))?.jobCode ?? "",
  );
  const [breakMin, setBreakMin] = useState(0);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [approve, setApprove] = useState(false);
  const [shiftStart, setShiftStart] = useState(true);
  const [extendEnd, setExtendEnd] = useState(true);
  const [reactivate, setReactivate] = useState(false);

  const worker = useMemo(
    () => workers.find((w) => w.id === (fixedWorkerId ?? workerId)),
    [workers, fixedWorkerId, workerId],
  );

  const proposal = useMemo(() => {
    if (!worker || !clockIn) {
      return {
        offers: {} as ContractAssignmentOffers,
        defaults: { shiftStart: false, extendEnd: false, reactivate: false },
      };
    }
    return proposeContractAssignmentOffers(
      {
        startDate: toDateOnly(worker.startDate),
        endDate: worker.endDate ? toDateOnly(worker.endDate) : null,
        status: worker.status,
      },
      toDateOnly(clockIn),
    );
  }, [worker, clockIn]);

  const offerKey = `${proposal.offers.shiftStartTo ?? ""}|${proposal.offers.extendEndTo ?? ""}|${proposal.offers.reactivate ? 1 : 0}`;
  useEffect(() => {
    setShiftStart(proposal.defaults.shiftStart);
    setExtendEnd(proposal.defaults.extendEnd);
    setReactivate(proposal.defaults.reactivate);
  }, [offerKey, proposal.defaults.extendEnd, proposal.defaults.reactivate, proposal.defaults.shiftStart]);

  function closeForm() {
    setOpen(false);
  }

  function reset() {
    setClockIn("");
    setClockOut("");
    setJobCode(worker?.jobCode ?? "");
    setBreakMin(0);
    setNotes("");
    setReason("");
    setApprove(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!worker) {
      toast.error("Choose a contract worker.");
      return;
    }
    if (!clockIn || !clockOut) {
      toast.error("Enter clock-in and clock-out.");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("Enter a reason (at least 3 characters).");
      return;
    }

    startTransition(async () => {
      const res = await runAction(() =>
        adminCreateManualContractTimeEntry({
          contractWorkerId: worker.id,
          clockIn,
          clockOut,
          jobCode: jobCode || undefined,
          notes: notes.trim() || null,
          breakMin,
          reason: reason.trim(),
          approve,
          offers: buildOffers({ shiftStart, extendEnd, reactivate }, proposal.offers),
        }),
      );
      if (!toastAction(res)) return;
      toast.success(
        approve ? "Entry added and approved." : "Entry added. It is pending approval.",
      );
      reset();
      closeForm();
      router.refresh();
    });
  }

  const hasHelper =
    !!proposal.offers.shiftStartTo ||
    !!proposal.offers.extendEndTo ||
    !!proposal.offers.reactivate;

  return (
    <Collapsible
      className={cn("min-w-0 space-y-3", open && "w-full basis-full", className)}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          const id = fixedWorkerId ?? workers[0]?.id ?? "";
          setWorkerId(id);
          setJobCode(workers.find((w) => w.id === id)?.jobCode ?? "");
        }
      }}
    >
      <CollapsibleTrigger asChild disabled={pending}>
        <Button type="button" size="sm" variant="outline" className="min-h-11 w-full sm:w-auto md:min-h-9">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <section
          aria-labelledby={`${formId}-heading`}
          className="max-w-3xl space-y-4 rounded-lg border bg-card p-4 sm:p-6"
        >
          <div className="space-y-1">
            <h2 id={`${formId}-heading`} className="text-lg font-semibold tracking-tight">
              Add contract hours
            </h2>
            <p className="text-sm text-muted-foreground">
              Closed shift for history or a missed punch. Times are America/Chicago.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {!fixedWorkerId && (
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-worker`} className="text-xs">
                  Worker
                </Label>
                <SimpleSelect
                  id={`${formId}-worker`}
                  value={workerId}
                  onValueChange={(v) => {
                    setWorkerId(v);
                    setJobCode(workers.find((w) => w.id === v)?.jobCode ?? "");
                  }}
                  options={workers.map((w) => ({
                    value: w.id,
                    label: `${w.name} · ${w.workerId} (${w.status.toLowerCase()})`,
                  }))}
                  placeholder="Choose worker"
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-in`} className="text-xs">
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
                <Label htmlFor={`${formId}-out`} className="text-xs">
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-job`} className="text-xs">
                  Job code
                </Label>
                <SimpleSelect
                  id={`${formId}-job`}
                  value={jobCode}
                  onValueChange={setJobCode}
                  options={[
                    { value: "", label: "Worker / company default" },
                    ...jobCodes.map((j) => ({
                      value: j.code,
                      label: `${j.code} — ${j.title}`,
                    })),
                  ]}
                  placeholder="Job code"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-break`} className="text-xs">
                  Break (min)
                </Label>
                <Input
                  id={`${formId}-break`}
                  type="number"
                  min={0}
                  max={240}
                  className="min-h-11 md:min-h-9"
                  value={breakMin}
                  onChange={(e) => setBreakMin(Number(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-notes`} className="text-xs">
                Notes
              </Label>
              <Textarea
                id={`${formId}-notes`}
                rows={2}
                value={notes}
                maxLength={1000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-reason`} className="text-xs">
                Reason (required)
              </Label>
              <Input
                id={`${formId}-reason`}
                className="min-h-11 md:min-h-9"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Backfill from agency timesheet"
                required
              />
            </div>

            {hasHelper && (
              <div className="space-y-2.5 rounded-md border border-border/80 bg-muted/40 px-3 py-3">
                <p className="text-xs font-medium text-foreground">Assignment helper</p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  This day is outside the current assignment. Choose what to update — nothing
                  changes unless you leave it checked.
                </p>
                <div className="space-y-2">
                  {proposal.offers.shiftStartTo && (
                    <label className="flex items-start gap-2.5 text-sm">
                      <Checkbox
                        checked={shiftStart}
                        onCheckedChange={(v) => setShiftStart(v === true)}
                        className="mt-0.5"
                      />
                      <span>
                        Move start date to <span className="font-medium">{proposal.offers.shiftStartTo}</span>
                      </span>
                    </label>
                  )}
                  {proposal.offers.extendEndTo && (
                    <label className="flex items-start gap-2.5 text-sm">
                      <Checkbox
                        checked={extendEnd}
                        onCheckedChange={(v) => setExtendEnd(v === true)}
                        className="mt-0.5"
                      />
                      <span>
                        Extend end date to <span className="font-medium">{proposal.offers.extendEndTo}</span>
                      </span>
                    </label>
                  )}
                  {proposal.offers.reactivate && (
                    <label className="flex items-start gap-2.5 text-sm">
                      <Checkbox
                        checked={reactivate}
                        onCheckedChange={(v) => setReactivate(v === true)}
                        className="mt-0.5"
                      />
                      <span>Reactivate worker (can clock in again)</span>
                    </label>
                  )}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={approve} onCheckedChange={(v) => setApprove(v === true)} />
              Approve immediately
            </label>

            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end [&_button]:min-h-11 md:[&_button]:min-h-9">
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
