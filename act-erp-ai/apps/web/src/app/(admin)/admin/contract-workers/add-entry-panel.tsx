"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/simple-select";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
} from "@/components/inline-panel";
import {
  proposeContractAssignmentOffers,
  type ContractAssignmentOffers,
} from "@/lib/contract-workers";
import { parseDateOnly } from "@/lib/time-rules";
import { runAction, toastAction } from "@/lib/toast-action";
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

export function AddContractEntryButton({
  workers,
  jobCodes,
  fixedWorkerId,
  label = "Add entry",
}: {
  workers: ContractEntryWorkerOption[];
  jobCodes: JobCodeOption[];
  fixedWorkerId?: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [workerId, setWorkerId] = useState(fixedWorkerId ?? workers[0]?.id ?? "");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [jobCode, setJobCode] = useState("");
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

  function reset() {
    setClockIn("");
    setClockOut("");
    setJobCode(worker?.jobCode ?? "");
    setBreakMin(0);
    setNotes("");
    setReason("");
    setApprove(false);
  }

  function submit() {
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
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          const id = fixedWorkerId ?? workers[0]?.id ?? "";
          setWorkerId(id);
          setJobCode(workers.find((w) => w.id === id)?.jobCode ?? "");
          setOpen(true);
        }}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        {label}
      </Button>
      <InlinePanel
        disabled={pending}
        open={open}
        onOpenChange={(v) => {
          if (!pending) setOpen(v);
        }}
      >
        <InlinePanelContent
          className="my-2"
          panelSlot={fixedWorkerId ? `cw-add-${fixedWorkerId}` : "cw-add-hours"}
        >
          <InlinePanelHeader>
            <InlinePanelTitle>Add contract hours</InlinePanelTitle>
            <InlinePanelDescription>
              Closed shift for history or a missed punch. Times are America/Chicago.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="space-y-3 px-1 py-2">
            {!fixedWorkerId && (
              <div className="space-y-1.5">
                <Label className="text-xs">Worker</Label>
                <SimpleSelect
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
                <Label className="text-xs">Clock in</Label>
                <Input
                  type="datetime-local"
                  className="min-h-11 md:min-h-9"
                  value={clockIn}
                  onChange={(e) => setClockIn(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Clock out</Label>
                <Input
                  type="datetime-local"
                  className="min-h-11 md:min-h-9"
                  value={clockOut}
                  onChange={(e) => setClockOut(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Job code</Label>
              <SimpleSelect
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
              <Label className="text-xs">Unpaid break (minutes)</Label>
              <Input
                type="number"
                min={0}
                max={240}
                className="min-h-11 md:min-h-9 w-28"
                value={breakMin}
                onChange={(e) => setBreakMin(Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea
                rows={2}
                value={notes}
                maxLength={1000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason (required)</Label>
              <Input
                className="min-h-11 md:min-h-9"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Backfill from agency timesheet"
              />
            </div>
            {(proposal.offers.shiftStartTo ||
              proposal.offers.extendEndTo ||
              proposal.offers.reactivate) && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium">Assignment helper</p>
                {proposal.offers.shiftStartTo && (
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={shiftStart}
                      onCheckedChange={(v) => setShiftStart(v === true)}
                      className="mt-0.5"
                    />
                    <span>
                      Shift start date to {proposal.offers.shiftStartTo} so this day is covered.
                    </span>
                  </label>
                )}
                {proposal.offers.extendEndTo && (
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={extendEnd}
                      onCheckedChange={(v) => setExtendEnd(v === true)}
                      className="mt-0.5"
                    />
                    <span>
                      Extend end date to {proposal.offers.extendEndTo} so this day is covered.
                    </span>
                  </label>
                )}
                {proposal.offers.reactivate && (
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={reactivate}
                      onCheckedChange={(v) => setReactivate(v === true)}
                      className="mt-0.5"
                    />
                    <span>Reactivate this worker (puts them eligible to clock in again).</span>
                  </label>
                )}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={approve} onCheckedChange={(v) => setApprove(v === true)} />
              Approve immediately
            </label>
          </div>
          <InlinePanelFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={pending} onClick={submit}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add entry
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>
    </>
  );
}
