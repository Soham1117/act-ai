"use client";

import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
} from "@/components/inline-panel";
import { runAction, toastAction } from "@/lib/toast-action";
import { generatePayrollSlipWorkbook } from "./actions";

export function DownloadCsvButton({
  periodId,
  blockingExceptions,
}: {
  periodId: string;
  blockingExceptions: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  function download(reason?: string) {
    startTransition(async () => {
      const res = await runAction(() => generatePayrollSlipWorkbook(periodId, reason));
      if (!toastAction(res)) return;
      const blob = new Blob([Uint8Array.from(atob(res.xlsx), (c) => c.charCodeAt(0))], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setOverrideOpen(false);
      setOverrideReason("");
      toast.success(reason ? "Excel downloaded with audited override" : "Excel downloaded");
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
        {pending ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="mr-1.5 h-3.5 w-3.5" />
        )}
        Download Excel
      </Button>
      <InlinePanel open={overrideOpen} onOpenChange={setOverrideOpen}>
        <InlinePanelContent>
          <InlinePanelHeader>
            <InlinePanelTitle>Override payroll readiness?</InlinePanelTitle>
            <InlinePanelDescription>
              This period has unresolved employee time. Review the readiness list before
              exporting. Continuing requires a reason and creates an audit record.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="space-y-2">
            <Label htmlFor="payroll-override-reason">Override reason</Label>
            <Textarea
              id="payroll-override-reason"
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              maxLength={500}
              placeholder="Explain why payroll can be exported with these exceptions…"
            />
            <p className="text-xs text-muted-foreground">
              At least 10 characters required.
            </p>
          </div>
          <InlinePanelFooter>
            <Button
              variant="outline"
              onClick={() => setOverrideOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => download(overrideReason.trim())}
              disabled={pending || overrideReason.trim().length < 10}
            >
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Export with override
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>
    </>
  );
}
