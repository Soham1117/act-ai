"use client";

import { useState, useTransition } from "react";
import { UserMinus, UserCheck, Loader2 } from "lucide-react";
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

export function StatusToggle({
  employeeId,
  status,
}: {
  employeeId: string;
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const isInactive = status === "TERMINATED";

  if (!isInactive) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <UserMinus className="mr-2 h-3.5 w-3.5" /> Deactivate
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Deactivate employee</DialogTitle>
            <DialogDescription>
              The employee&apos;s record stays in the database but is hidden from the
              main table. You can reactivate at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason (optional)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Resigned, end of contract, etc."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await setEmploymentStatus(employeeId, "TERMINATED", reason || undefined);
                  if (!toastAction(res)) return;
                  toast.success("Employee deactivated");
                  setOpen(false);
                  setReason("");
                })
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
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
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-3.5 w-3.5" />}
      Reactivate
    </Button>
  );
}
