"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { deletePayrollPeriod, updatePayrollPeriod } from "@/server/actions/payroll";
import { toastAction } from "@/lib/toast-action";

export type EditablePeriod = {
  id: string;
  title: string;
  payPeriodStart: string; // YYYY-MM-DD
  payPeriodEnd: string;
  payDate: string;
  notes: string | null;
  completedOverride: boolean;
};

export function PeriodActions({ period }: { period: EditablePeriod }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(period.title);
  const [start, setStart] = useState(period.payPeriodStart);
  const [end, setEnd] = useState(period.payPeriodEnd);
  const [payDate, setPayDate] = useState(period.payDate);
  const [status, setStatus] = useState<"AUTO" | "COMPLETED">(
    period.completedOverride ? "COMPLETED" : "AUTO",
  );
  const [notes, setNotes] = useState(period.notes ?? "");

  const datesInvalid = !!start && !!end && !!payDate && (end < start || payDate < end);

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updatePayrollPeriod(period.id, {
        title,
        payPeriodStart: start,
        payPeriodEnd: end,
        payDate,
        status,
        notes: notes || undefined,
      });
      if (!toastAction(res)) return;
      toast.success("Pay period updated");
      setOpen(false);
    });
  }

  function onDelete() {
    if (
      !confirm(
        `Delete pay period "${period.title}"? Uploaded pay documents are not affected, but the period and its slip will be removed.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await deletePayrollPeriod(period.id);
      if (!toastAction(res)) return;
      toast.success("Pay period deleted");
    });
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen(true)} aria-label="Edit pay period">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete} disabled={pending} aria-label="Delete pay period">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit pay period</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSave} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Period start</Label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Period end</Label>
                <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Pay date</Label>
                <Input type="date" value={payDate} min={end} onChange={(e) => setPayDate(e.target.value)} required />
              </div>
            </div>
            {datesInvalid && (
              <p className="text-xs text-destructive">
                The end can&apos;t be before the start, and the pay date can&apos;t be before the end.
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Automatic (from dates)</SelectItem>
                  <SelectItem value="COMPLETED">Mark completed (closed early)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || datesInvalid || !title || !start || !end || !payDate}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
