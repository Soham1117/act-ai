"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, Pencil, Plus, RotateCcw, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { toastAction } from "@/lib/toast-action";
import { businessDateOnly } from "@/lib/format";
import { dateOnlyToString } from "@/lib/time-rules";
import {
  adminClockOutContractWorker,
  createContractWorker,
  endContractWorker,
  reactivateContractWorker,
  updateContractWorker,
} from "@/server/actions/contract-workers";
import { selectClass, type AgencyOption, type JobCodeOption, type WorkerRow } from "./shared";

function todayString() {
  return dateOnlyToString(businessDateOnly());
}

/** Add (no `worker`) or edit a contract worker. */
export function WorkerFormDialog({
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
        const res = await updateContractWorker(worker.id, input);
        if (!toastAction(res)) return;
        toast.success("Worker updated");
      } else {
        const res = await createContractWorker(input);
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
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add contract worker
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${worker?.name}`}>
          <Pencil className="mr-1 h-3.5 w-3.5" />
          Edit
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (v && worker) reset();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{worker ? `Edit ${worker.workerId}` : "Add contract worker"}</DialogTitle>
            <DialogDescription>Agency staff only. Pay rates are not stored here.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="cw-name">Name</Label>
              <Input id="cw-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cw-agency">Agency</Label>
              <select
                id="cw-agency"
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
              <Label htmlFor="cw-phone">Phone</Label>
              <Input id="cw-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cw-job">Job code</Label>
              <select
                id="cw-job"
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
              <Label htmlFor="cw-project">Project</Label>
              <Input id="cw-project" value={project} onChange={(e) => setProject(e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cw-start">Start date</Label>
              <Input id="cw-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cw-end">End date (optional)</Label>
              <Input id="cw-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="cw-notes">Notes</Label>
              <Textarea id="cw-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {worker ? "Save changes" : "Add worker"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EndAssignmentButton({ worker }: { worker: WorkerRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await endContractWorker(worker.id, endDate || undefined);
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
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <UserX className="mr-1 h-3.5 w-3.5" />
        End
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End assignment for {worker.name}?</DialogTitle>
            <DialogDescription>
              The worker cannot clock in after this. If the worker is clocked in now, the shift is
              closed and goes to approval. You can reactivate the worker later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`end-${worker.id}`}>End date (optional, default today)</Label>
            <Input
              id={`end-${worker.id}`}
              type="date"
              value={endDate}
              min={worker.startDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              End assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReactivateButton({ worker }: { worker: WorkerRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await reactivateContractWorker(worker.id, endDate || undefined);
      if (!toastAction(res)) return;
      toast.success(`${worker.name} reactivated`);
      setOpen(false);
      setEndDate("");
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <RotateCcw className="mr-1 h-3.5 w-3.5" />
        Reactivate
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reactivate {worker.name}?</DialogTitle>
            <DialogDescription>
              The worker can clock in again. Set a new end date if the new assignment has one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`re-${worker.id}`}>New end date (optional)</Label>
            <Input
              id={`re-${worker.id}`}
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Reactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ClockOutButton({ workerId, name }: { workerId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await adminClockOutContractWorker(workerId);
      if (!toastAction(res)) return;
      toast.success(`${name} clocked out. The entry needs approval.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <LogOut className="mr-1 h-3.5 w-3.5" />
        Clock out
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clock out {name}?</DialogTitle>
            <DialogDescription>
              This closes the open shift at the current time. The entry goes to approval.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Clock out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
