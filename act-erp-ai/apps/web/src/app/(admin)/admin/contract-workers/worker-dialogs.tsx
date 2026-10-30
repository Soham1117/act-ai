"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  UserX,
  Pause,
} from "lucide-react";
import { toast } from "sonner";
import { InlineConfirmAction } from "@/components/inline-confirm-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
} from "@/components/inline-panel";
import { runAction, toastAction } from "@/lib/toast-action";
import { businessDateOnly } from "@/lib/format";
import { dateOnlyToString } from "@/lib/time-rules";
import {
  adminClockOutContractWorker,
  createContractWorker,
  endContractWorker,
  reactivateContractWorker,
  resetContractWorkerKioskPin,
  updateContractWorker,
  setContractWorkerActive,
} from "@/server/actions/contract-workers";
import {
  selectClass,
  type AgencyOption,
  type JobCodeOption,
  type WorkerRow,
} from "./shared";

function todayString() {
  return dateOnlyToString(businessDateOnly());
}

/** Add (no `worker`) or edit a contract worker. */
export function WorkerForm({
  worker,
  agencies,
  jobCodes,
  trigger = "add",
}: {
  worker?: WorkerRow;
  agencies: AgencyOption[];
  jobCodes: JobCodeOption[];
  trigger?: "add" | "edit";
}) {
  const formId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(worker?.name ?? "");
  const [phone, setPhone] = useState(worker?.phone ?? "");
  const [agencyId, setAgencyId] = useState(worker?.agencyId ?? "");
  const [jobCode, setJobCode] = useState(worker?.jobCode ?? "");
  const [project, setProject] = useState(worker?.project ?? "");
  const [startDate, setStartDate] = useState(worker?.startDate ?? todayString());
  const [endDate, setEndDate] = useState(worker?.endDate ?? "");
  const [notes, setNotes] = useState(worker?.notes ?? "");

  const agencyChoices = agencies.filter((a) => a.isActive || a.id === worker?.agencyId);
  const jobChoices =
    !jobCode || jobCodes.some((j) => j.code === jobCode)
      ? jobCodes
      : [...jobCodes, { code: jobCode, title: "inactive" }];

  function reset() {
    setName(worker?.name ?? "");
    setPhone(worker?.phone ?? "");
    setAgencyId(worker?.agencyId ?? "");
    setJobCode(worker?.jobCode ?? "");
    setProject(worker?.project ?? "");
    setStartDate(worker?.startDate ?? todayString());
    setEndDate(worker?.endDate ?? "");
    setNotes(worker?.notes ?? "");
  }

  function submit() {
    if (!name.trim()) return toast.error("Enter the worker's name.");
    if (!agencyId) return toast.error("Choose an agency.");
    if (!startDate) return toast.error("Enter a start date.");
    const input = {
      name,
      phone: phone || null,
      agencyId,
      jobCode: jobCode || null,
      project: project || null,
      startDate,
      endDate: endDate || null,
      notes: notes || null,
    };
    startTransition(async () => {
      if (worker) {
        const res = await runAction(() => updateContractWorker(worker.id, input));
        if (!toastAction(res)) return;
        toast.success("Worker updated");
      } else {
        const res = await runAction(() => createContractWorker(input));
        if (!toastAction(res)) return;
        toast.success(`Added ${res.workerId}`);
      }
      setOpen(false);
      if (!worker) reset();
      router.refresh();
    });
  }

  return (
    <>
      {trigger === "add" ? (
        <Button className="min-h-11 md:min-h-9" size="sm" onClick={() => { if (!pending) setOpen(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add contract worker
        </Button>
      ) : (
        <Button
          className="min-h-11 md:min-h-9"
          size="sm"
          variant="ghost"
          onClick={() => { if (!pending) setOpen(true); }}
          aria-label={`Edit ${worker?.name}`}
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          Edit
        </Button>
      )}
      <InlinePanel
        open={open}
        onOpenChange={(v) => {
          if (pending) return;
          setOpen(v);
          if (v && worker) reset();
        }}
      >
        <InlinePanelContent panelSlot={worker ? `worker-${worker.id}` : undefined}>
          <InlinePanelHeader>
            <InlinePanelTitle>
              {worker ? `Edit ${worker.workerId}` : "Add contract worker"}
            </InlinePanelTitle>
            <InlinePanelDescription>
              Agency staff only. Pay rates are not stored here.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`${formId}-name`}>Name</Label>
              <Input
                id={`${formId}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-agency`}>Agency</Label>
              <select
                id={`${formId}-agency`}
                className={selectClass}
                value={agencyId}
                onChange={(e) => setAgencyId(e.target.value)}
              >
                <option value="">Choose an agency</option>
                {agencyChoices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.isActive ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-phone`}>Phone</Label>
              <Input
                id={`${formId}-phone`}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={40}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-job`}>Job code</Label>
              <select
                id={`${formId}-job`}
                className={selectClass}
                value={jobCode}
                onChange={(e) => setJobCode(e.target.value)}
              >
                <option value="">None</option>
                {jobChoices.map((j) => (
                  <option key={j.code} value={j.code}>
                    {j.code} - {j.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-project`}>Project</Label>
              <Input
                id={`${formId}-project`}
                value={project}
                onChange={(e) => setProject(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-start`}>Start date</Label>
              <Input
                id={`${formId}-start`}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-end`}>End date (optional)</Label>
              <Input
                id={`${formId}-end`}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`${formId}-notes`}>Notes</Label>
              <Textarea
                id={`${formId}-notes`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
              />
            </div>
          </div>
          <InlinePanelFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {worker ? "Save changes" : "Add worker"}
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>
    </>
  );
}

/** Temporary pause/resume; separate from ending an assignment. */
export function WorkerActiveButton({ worker }: { worker: WorkerRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = worker.status === "ACTIVE";
  const label = active ? "Make inactive" : "Activate";
  return (
    <>
      <Button
        className="min-h-11 md:min-h-9"
        size="sm"
        variant="ghost"
        onClick={() => { if (!pending) setOpen(true); }}
        disabled={pending}
      >
        {active ? (
          <Pause className="mr-1 h-3.5 w-3.5" />
        ) : (
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
        )}
        {label}
      </Button>
      <InlinePanel disabled={pending} open={open} onOpenChange={(nextOpen) => { if (!pending) setOpen(nextOpen); }}>
        <InlinePanelContent panelSlot={`worker-${worker.id}`}>
          <InlinePanelHeader>
            <InlinePanelTitle>
              {label}: {worker.name}?
            </InlinePanelTitle>
            <InlinePanelDescription>
              {active
                ? "The worker cannot clock in while inactive. The assignment dates and history are kept. Any open shift is clocked out for approval. You can activate them again later."
                : "The worker becomes active again with the same assignment dates. They can clock in within those dates."}
            </InlinePanelDescription>
          </InlinePanelHeader>
          <InlinePanelFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await runAction(() =>
                    setContractWorkerActive(worker.id, !active),
                  );
                  if (!toastAction(res)) return;
                  toast.success(
                    `${worker.name} ${active ? "made inactive" : "activated"}${res.closedOpenEntries ? ". Open shifts closed for approval." : ""}`,
                  );
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {label}
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>
    </>
  );
}

export function EndAssignmentButton({ worker }: { worker: WorkerRow }) {
  const formId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await runAction(() =>
        endContractWorker(worker.id, endDate || undefined),
      );
      if (!toastAction(res)) return;
      toast.success(
        res.closedOpenEntry
          ? `${worker.name} ended. The open shift was clocked out and needs approval.`
          : `${worker.name} ended`,
      );
      setOpen(false);
      setEndDate("");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        className="min-h-11 md:min-h-9"
        size="sm"
        variant="ghost"
        onClick={() => { if (!pending) setOpen(true); }}
      >
        <UserX className="mr-1 h-3.5 w-3.5" />
        End
      </Button>
      <InlinePanel disabled={pending} open={open} onOpenChange={(nextOpen) => { if (!pending) setOpen(nextOpen); }}>
        <InlinePanelContent panelSlot={`worker-${worker.id}`}>
          <InlinePanelHeader>
            <InlinePanelTitle>End assignment for {worker.name}?</InlinePanelTitle>
            <InlinePanelDescription>
              The worker cannot clock in after this. If the worker is clocked in now, the
              shift is closed and goes to approval. You can reactivate the worker later.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="space-y-1">
            <Label htmlFor={`${formId}-end`}>End date (optional, default today)</Label>
            <Input
              id={`${formId}-end`}
              type="date"
              value={endDate}
              min={worker.startDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <InlinePanelFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              End assignment
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>
    </>
  );
}

export function ReactivateButton({ worker }: { worker: WorkerRow }) {
  const formId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await runAction(() =>
        reactivateContractWorker(worker.id, endDate || undefined),
      );
      if (!toastAction(res)) return;
      toast.success(`${worker.name} reactivated`);
      setOpen(false);
      setEndDate("");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        className="min-h-11 md:min-h-9"
        size="sm"
        variant="ghost"
        onClick={() => { if (!pending) setOpen(true); }}
      >
        <RotateCcw className="mr-1 h-3.5 w-3.5" />
        Reactivate
      </Button>
      <InlinePanel disabled={pending} open={open} onOpenChange={(nextOpen) => { if (!pending) setOpen(nextOpen); }}>
        <InlinePanelContent panelSlot={`worker-${worker.id}`}>
          <InlinePanelHeader>
            <InlinePanelTitle>Reactivate {worker.name}?</InlinePanelTitle>
            <InlinePanelDescription>
              The worker can clock in again. Set a new end date if the new assignment has
              one.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="space-y-1">
            <Label htmlFor={`${formId}-end`}>New end date (optional)</Label>
            <Input
              id={`${formId}-end`}
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <InlinePanelFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Reactivate
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>
    </>
  );
}

export function ClockOutButton({ workerId, name }: { workerId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await runAction(() => adminClockOutContractWorker(workerId));
      if (!toastAction(res)) return;
      toast.success(`${name} clocked out. The entry needs approval.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        className="min-h-11 md:min-h-9"
        size="sm"
        variant="outline"
        onClick={() => { if (!pending) setOpen(true); }}
      >
        <LogOut className="mr-1 h-3.5 w-3.5" />
        Clock out
      </Button>
      <InlinePanel disabled={pending} open={open} onOpenChange={(nextOpen) => { if (!pending) setOpen(nextOpen); }}>
        <InlinePanelContent panelSlot={`worker-${workerId}`}>
          <InlinePanelHeader>
            <InlinePanelTitle>Clock out {name}?</InlinePanelTitle>
            <InlinePanelDescription>
              This closes the open shift at the current time. The entry goes to approval.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <InlinePanelFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Clock out
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>
    </>
  );
}

export function ResetPinButton({ workerId, name }: { workerId: string; name: string }) {
  return (
    <InlineConfirmAction
      label="Reset PIN"
      cancelLabel="Cancel"
      variant="outline"
      message={`Reset ${name}'s kiosk PIN to the temporary default 3214?`}
      onConfirm={async () => {
        const res = await runAction(() => resetContractWorkerKioskPin(workerId));
        if (!toastAction(res)) return false;
        toast.success("Kiosk PIN reset to 3214");
        return true;
      }}
    >
      <KeyRound className="mr-1 h-3.5 w-3.5" />
      Reset PIN
    </InlineConfirmAction>
  );
}
