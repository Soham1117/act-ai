"use client";

import { useState, useTransition } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastAction } from "@/lib/toast-action";
import { adjustLeaveBalance } from "@/server/actions/leave";
import { LEAVE_TYPES } from "@/lib/leave-balance";

export function AdjustBalanceDialog({
  employeeId,
  employeeName,
  year,
  size = "sm",
}: {
  employeeId: string;
  employeeName: string;
  year: number;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<(typeof LEAVE_TYPES)[number]>("ANNUAL");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");

  const n = Number(days);
  const valid = days.trim() !== "" && Number.isFinite(n) && n !== 0 && reason.trim().length >= 3;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await adjustLeaveBalance({
        employeeId,
        leaveType: type,
        year,
        days: n,
        reason: reason.trim(),
      });
      if (!toastAction(res)) return;
      toast.success("Balance adjusted");
      setOpen(false);
      setDays("");
      setReason("");
    });
  }

  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="mr-1 h-3.5 w-3.5" /> Adjust
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust leave balance</DialogTitle>
            <DialogDescription>
              {employeeName} · {year}. Use a negative number to deduct days. Recorded in the audit log
              and the employee is notified.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Leave type</Label>
              <Select value={type} onValueChange={(v) => setType(v as (typeof LEAVE_TYPES)[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Days (+/-)</Label>
              <Input
                type="number"
                step="0.5"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="e.g. 2 or -1.5"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason (required)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || !valid}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save adjustment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
