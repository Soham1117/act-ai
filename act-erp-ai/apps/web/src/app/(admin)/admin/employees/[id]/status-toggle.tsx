"use client";

import { useState, useTransition } from "react";
import { UserMinus, UserCheck, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastAction } from "@/lib/toast-action";
import { setEmploymentStatus } from "@/server/actions/employees";
import { TERMINATION_GRACE_DAYS } from "@/lib/access";
import { todayDateString } from "@/lib/employee-validation";

export function StatusToggle({
  employeeId,
  status,
  isAdmin,
  terminationDate,
  terminationReason,
}: {
  employeeId: string;
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED" | "PENDING_REVIEW";
  /** Admin accounts must be demoted before they can be terminated. */
  isAdmin: boolean;
  /** ISO timestamp of the current termination date (TERMINATED only). */
  terminationDate: string | null;
  terminationReason: string | null;
}) {
  const isTerminated = status === "TERMINATED";
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(
    terminationDate ? terminationDate.slice(0, 10) : todayDateString(),
  );
  const [reason, setReason] = useState(terminationReason ?? "");
  const [pending, startTransition] = useTransition();

  // Pending hires are approved/rejected with their own buttons.
  if (status === "PENDING_REVIEW") return null;

  const terminateDialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isTerminated ? (
          <Button variant="ghost" size="sm">
            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit termination
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={isAdmin}
            title={isAdmin ? "Remove their admin role first (Access card below)" : undefined}
          >
            <UserMinus className="mr-2 h-3.5 w-3.5" /> Terminate
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isTerminated ? "Edit termination" : "Terminate employee"}</DialogTitle>
          <DialogDescription>
            The employee record and all documents are kept. The employee can still sign in
            <strong> read-only for {TERMINATION_GRACE_DAYS} days after the termination date</strong>{" "}
            (to view pay stubs and documents), then sign-in stops. They can&apos;t use the
            time clock kiosk once terminated. You can reactivate at any time.
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
            <p className="text-[11px] text-muted-foreground">
              Defaults to today. Backdate if they left earlier; it can&apos;t be in the future.
            </p>
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
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || !date}
            onClick={() =>
              startTransition(async () => {
                const res = await setEmploymentStatus(employeeId, "TERMINATED", {
                  reason: reason || undefined,
                  terminationDate: date,
                });
                if (!toastAction(res)) return;
                toast.success(isTerminated ? "Termination updated" : "Employee terminated");
                setOpen(false);
              })
            }
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isTerminated ? "Save" : "Terminate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (!isTerminated) return terminateDialog;

  return (
    <>
      {terminateDialog}
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await setEmploymentStatus(employeeId, "ACTIVE");
            if (!toastAction(res)) return;
            toast.success("Employee reactivated");
          })
        }
      >
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <UserCheck className="mr-2 h-3.5 w-3.5" />
        )}
        Reactivate
      </Button>
    </>
  );
}
