"use client";

import { useId, useState, useTransition } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
  InlinePanelTrigger,
} from "@/components/inline-panel";
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
import { runAction, toastAction } from "@/lib/toast-action";
import { adjustLeaveBalance } from "@/server/actions/leave";
import { LEAVE_TYPES } from "@/lib/leave-balance";

export function AdjustBalancePanel({
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
  const fieldId = useId();
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
      const res = await runAction(() => adjustLeaveBalance({
        employeeId,
        leaveType: type,
        year,
        days: n,
        reason: reason.trim(),
      }));
      if (!toastAction(res)) return;
      toast.success("Balance adjusted");
      setOpen(false);
      setDays("");
      setReason("");
    });
  }

  return (
    <InlinePanel disabled={pending} open={open} onOpenChange={setOpen}>
      <InlinePanelTrigger asChild disabled={pending}>
        <Button size={size} variant="outline">
          <SlidersHorizontal className="mr-1 h-3.5 w-3.5" /> Adjust
        </Button>
      </InlinePanelTrigger>
        <InlinePanelContent>
          <InlinePanelHeader>
            <InlinePanelTitle>Adjust leave balance</InlinePanelTitle>
            <InlinePanelDescription>
              {employeeName} · {year}. Use a negative number to deduct days. Recorded in the audit log
              and the employee is notified.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-1`} className="text-xs">Leave type</Label>
              <Select value={type} onValueChange={(v) => setType(v as (typeof LEAVE_TYPES)[number])}>
                <SelectTrigger id={`${fieldId}-1`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-2`} className="text-xs">Days (+/-)</Label>
              <Input id={`${fieldId}-2`}
                type="number"
                step="0.5"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="e.g. 2 or -1.5"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-3`} className="text-xs">Reason (required)</Label>
              <Textarea id={`${fieldId}-3`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} required />
            </div>
            <InlinePanelFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || !valid}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save adjustment
              </Button>
            </InlinePanelFooter>
          </form>
        </InlinePanelContent>
    </InlinePanel>
  );
}
