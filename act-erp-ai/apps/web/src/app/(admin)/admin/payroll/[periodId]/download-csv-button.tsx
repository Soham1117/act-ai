"use client";

import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { runAction, toastAction } from "@/lib/toast-action";
import { generatePayrollSlipCsv } from "./actions";

export function DownloadCsvButton({
  periodId,
  title,
  blockingExceptions,
}: {
  periodId: string;
  title: string;
  blockingExceptions: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  function download(reason?: string) {
    startTransition(async () => {
      const res = await runAction(() => generatePayrollSlipCsv(periodId, reason));
      if (!toastAction(res)) return;
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll-slip-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setOverrideOpen(false);
      setOverrideReason("");
      toast.success(reason ? "CSV downloaded with audited override" : "CSV downloaded");
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => (blockingExceptions ? setOverrideOpen(true) : download())}
      >
        {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
        Download CSV
      </Button>
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override payroll readiness?</DialogTitle>
            <DialogDescription>
              This period has unresolved employee time. Review the readiness list before exporting.
              Continuing requires a reason and creates an audit record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="payroll-override-reason">Override reason</Label>
            <Textarea
              id="payroll-override-reason"
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              maxLength={500}
              placeholder="Explain why payroll can be exported with these exceptions…"
            />
            <p className="text-xs text-muted-foreground">At least 10 characters required.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={() => download(overrideReason.trim())}
              disabled={pending || overrideReason.trim().length < 10}
            >
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Export with override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
