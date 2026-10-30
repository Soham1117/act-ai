"use client";

import { useId, useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InlinePanel,
  InlinePanelContent,
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
import { createPayrollPeriod } from "@/server/actions/payroll";
import { runAction, toastAction } from "@/lib/toast-action";

export function CreatePayrollPeriodForm() {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [payDate, setPayDate] = useState("");
  const [notes, setNotes] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await runAction(() =>
        createPayrollPeriod({
          title,
          payPeriodStart: start,
          payPeriodEnd: end,
          payDate,
          notes: notes || undefined,
        }),
      );
      if (!toastAction(res)) return;
      toast.success("Pay period created");
      setOpen(false);
      setTitle("");
      setStart("");
      setEnd("");
      setPayDate("");
      setNotes("");
    });
  }

  return (
    <InlinePanel open={open} onOpenChange={setOpen}>
      <InlinePanelTrigger asChild disabled={pending}>
        <Button variant="outline" size="sm">
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add a period manually
        </Button>
      </InlinePanelTrigger>
      <InlinePanelContent>
        <InlinePanelHeader>
          <InlinePanelTitle>Add a pay period manually</InlinePanelTitle>
        </InlinePanelHeader>
        <form onSubmit={onSubmit} className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-field-0`} className="text-xs">
              Title
            </Label>
            <Input
              id={`${formId}-field-0`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Bi-weekly · 2026-05-03 to 2026-05-16"
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
              disabled={
                pending ||
                !title ||
                !start ||
                !end ||
                !payDate ||
                end < start ||
                payDate < end
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}
