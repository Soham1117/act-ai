"use client";

import { useId, useState, useTransition } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { InlineConfirmAction } from "@/components/inline-confirm-action";
import { Button } from "@/components/ui/button";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
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
import { deletePayrollPeriod, updatePayrollPeriod } from "@/server/actions/payroll";
import { runAction, toastAction } from "@/lib/toast-action";

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
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(period.title);
  const [start, setStart] = useState(period.payPeriodStart);
  const [end, setEnd] = useState(period.payPeriodEnd);
  const [payDate, setPayDate] = useState(period.payDate);
  const [notes, setNotes] = useState(period.notes ?? "");

  const datesInvalid = !!start && !!end && !!payDate && (end < start || payDate < end);

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await runAction(() =>
        updatePayrollPeriod(period.id, {
          title,
          payPeriodStart: start,
          payPeriodEnd: end,
          payDate,
          notes: notes || undefined,
        }),
      );
      if (!toastAction(res)) return;
      toast.success("Pay period updated");
      setOpen(false);
    });
  }

  return (
    <div className="w-full min-w-0 basis-full">
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-11 w-11 md:h-9 md:w-9"
          onClick={() => setOpen(true)}
          aria-label="Edit pay period"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <InlineConfirmAction
          label="Delete pay period"
          message={`Delete pay period "${period.title}"? Uploaded pay documents are not affected, but the period and its slip will be removed.`}
          cancelLabel="Keep pay period"
          className="min-h-11 min-w-11 text-destructive md:min-h-9 md:min-w-9"
          onConfirm={async () => {
            const res = await runAction(() => deletePayrollPeriod(period.id));
            if (!toastAction(res)) return false;
            toast.success("Pay period deleted");
            return true;
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </InlineConfirmAction>
      </div>
      <InlinePanel open={open} onOpenChange={setOpen}>
        <InlinePanelContent>
          <InlinePanelHeader>
            <InlinePanelTitle>Edit pay period</InlinePanelTitle>
          </InlinePanelHeader>
          <form onSubmit={onSave} className="min-w-0 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-field-0`} className="text-xs">
                Title
              </Label>
              <Input
                id={`${formId}-field-0`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-field-1`} className="text-xs">
                  Period start
                </Label>
                <Input
                  id={`${formId}-field-1`}
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-field-2`} className="text-xs">
                  Period end
                </Label>
                <Input
                  id={`${formId}-field-2`}
                  type="date"
                  value={end}
                  min={start}
                  onChange={(e) => setEnd(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-field-3`} className="text-xs">
                  Pay date
                </Label>
                <Input
                  id={`${formId}-field-3`}
                  type="date"
                  value={payDate}
                  min={end}
                  onChange={(e) => setPayDate(e.target.value)}
                  required
                />
              </div>
            </div>
            {datesInvalid && (
              <p className="text-xs text-destructive">
                The end can&apos;t be before the start, and the pay date can&apos;t be
                before the end.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-field-5`} className="text-xs">
                Notes
              </Label>
              <Textarea
                id={`${formId}-field-5`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
            <InlinePanelFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || datesInvalid || !title || !start || !end || !payDate}
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </InlinePanelFooter>
          </form>
        </InlinePanelContent>
      </InlinePanel>
    </div>
  );
}
