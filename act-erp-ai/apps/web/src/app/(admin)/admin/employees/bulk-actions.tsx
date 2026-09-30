"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastAction } from "@/lib/toast-action";
import { bulkDeleteEmployees, bulkTerminateEmployees } from "@/server/actions/employees";
import { todayDateString } from "@/lib/employee-validation";
import { TERMINATION_GRACE_DAYS } from "@/lib/access";

type Selected = { id: string; name: string }[];

/**
 * Bulk Terminate (default offboarding: keeps records, read-only for 60 days)
 * and bulk Delete (permanent, typed confirmation). Only ever receives the
 * rows that are currently visible and selected.
 */
export function BulkActions({
  selected,
  onDone,
}: {
  selected: Selected;
  onDone: () => void;
}) {
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(todayDateString());
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [force, setForce] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const count = selected.length;
  const ids = selected.map((s) => s.id);
  const names = selected.slice(0, 6).map((s) => s.name).join(", ") + (count > 6 ? ", …" : "");

  function closeDelete() {
    setDeleteOpen(false);
    setTyped("");
    setForce(false);
    setDeleteError(null);
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => setTerminateOpen(true)}>
        <UserMinus className="mr-2 h-3.5 w-3.5" />
        Terminate {count}
      </Button>
      <Button variant="destructive" size="sm" disabled={pending} onClick={() => setDeleteOpen(true)}>
        <Trash2 className="mr-2 h-3.5 w-3.5" />
        Delete {count}
      </Button>

      <Dialog open={terminateOpen} onOpenChange={setTerminateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Terminate {count} employee{count === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              {names}. Their records and documents are kept. They can still sign in read-only for{" "}
              {TERMINATION_GRACE_DAYS} days after the termination date, then sign-in stops. Admins,
              yourself and anyone already terminated are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Termination date</Label>
              <Input
                type="date"
                value={date}
                max={todayDateString()}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason (optional)</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Resigned, end of contract, etc."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending || !date}
              onClick={() =>
                startTransition(async () => {
                  const res = await bulkTerminateEmployees(ids, {
                    terminationDate: date,
                    reason: reason || undefined,
                  });
                  if (!toastAction(res)) return;
                  toast.success(
                    `Terminated ${res.count} employee${res.count === 1 ? "" : "s"}` +
                      (res.skipped ? ` (${res.skipped} skipped)` : ""),
                  );
                  setTerminateOpen(false);
                  setReason("");
                  onDone();
                })
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Terminate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(o) => (o ? setDeleteOpen(true) : closeDelete())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Permanently delete {count} employee{count === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              {names}. This removes their login and their records and cannot be undone. To
              offboard someone normally, use Terminate instead (it keeps pay and time history).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {deleteError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {deleteError}
              </p>
            )}
            <div className="flex items-start gap-2">
              <Checkbox
                id="force-delete"
                checked={force}
                onCheckedChange={(v) => setForce(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="force-delete" className="text-xs leading-snug">
                Delete even if they have time, payroll or reimbursement history (that history is
                destroyed).
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </Label>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDelete}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending || typed !== "DELETE"}
              onClick={() =>
                startTransition(async () => {
                  setDeleteError(null);
                  const res = await bulkDeleteEmployees(ids, { confirm: typed, force });
                  if (!res.ok) {
                    setDeleteError(res.error);
                    return;
                  }
                  toast.success(`Deleted ${res.count} employee${res.count === 1 ? "" : "s"}`);
                  closeDelete();
                  onDone();
                })
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
