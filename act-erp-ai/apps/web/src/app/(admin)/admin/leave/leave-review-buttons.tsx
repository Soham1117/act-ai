"use client";

import { useId, useState, useTransition } from "react";
import { Check, Loader2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
} from "@/components/inline-panel";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { runAction, toastAction } from "@/lib/toast-action";
import type { ActionResult } from "@/lib/action-result";
import { cancelLeaveRequest, reviewLeave } from "@/server/actions/leave";

type Mode = "APPROVE" | "REJECT" | "REVERT";

const COPY: Record<Mode, { title: string; desc: string; confirm: string; required: boolean }> = {
  APPROVE: {
    title: "Approve leave",
    desc: "Optionally add a note. The employee is notified.",
    confirm: "Approve",
    required: false,
  },
  REJECT: {
    title: "Reject leave",
    desc: "A reason is required and is shown to the employee.",
    confirm: "Reject",
    required: true,
  },
  REVERT: {
    title: "Cancel approved leave",
    desc: "The days return to the employee's balance. A reason is required and is shown to the employee.",
    confirm: "Cancel leave",
    required: true,
  },
};

function ReviewPanel({
  id,
  mode,
  open,
  onOpenChange,
}: {
  id: string;
  mode: Mode;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const fieldId = useId();
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState("");
  const [override, setOverride] = useState(false);
  const c = COPY[mode];
  const missing = (c.required || (mode === "APPROVE" && override)) && notes.trim().length === 0;

  function run() {
    startTransition(async () => {
      const res: ActionResult<Record<string, unknown>> =
        mode === "REVERT"
          ? await runAction(() => cancelLeaveRequest(id, notes))
          : await runAction(() => reviewLeave({
              requestId: id,
              decision: mode === "APPROVE" ? "APPROVED" : "REJECTED",
              notes: notes.trim() || undefined,
              overrideBalance: mode === "APPROVE" ? override : undefined,
            }));
      if (!toastAction(res)) return;
      toast.success(mode === "APPROVE" ? "Approved" : mode === "REJECT" ? "Rejected" : "Leave cancelled");
      onOpenChange(false);
      setNotes("");
      setOverride(false);
    });
  }

  return (
    <InlinePanel disabled={pending} open={open} onOpenChange={onOpenChange}>
      <InlinePanelContent>
        <InlinePanelHeader>
          <InlinePanelTitle>{c.title}</InlinePanelTitle>
          <InlinePanelDescription>{c.desc}</InlinePanelDescription>
        </InlinePanelHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-1`} className="text-xs">
              {c.required ? "Reason (required)" : override ? "Override reason (required)" : "Note (optional)"}
            </Label>
            <Textarea id={`${fieldId}-1`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} />
          </div>
          {mode === "APPROVE" && (
            <label className="flex items-start gap-2 text-xs">
              <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} />
              <span>
                Approve even if this exceeds the employee&apos;s balance (requires a reason; recorded in the audit log).
              </span>
            </label>
          )}
        </div>
        <InlinePanelFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            variant={mode === "APPROVE" ? "success" : "destructive"}
            disabled={pending || missing}
            onClick={run}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {c.confirm}
          </Button>
        </InlinePanelFooter>
      </InlinePanelContent>
    </InlinePanel>
  );
}

export function LeaveReviewButtons({ id }: { id: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      <Button size="sm" variant="destructive" aria-expanded={mode === "REJECT"} onClick={() => setMode("REJECT")} aria-label="Reject">
        <X className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="success" aria-expanded={mode === "APPROVE"} onClick={() => setMode("APPROVE")}>
        <Check className="h-4 w-4" /> Approve
      </Button>
      {mode && (
        <ReviewPanel id={id} mode={mode} open onOpenChange={(o) => !o && setMode(null)} />
      )}
    </div>
  );
}

/** Admin revert of an APPROVED (or pending) leave. */
export function LeaveRevertButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(true)} title="Cancel this approved leave">
        <Undo2 className="mr-1 h-3.5 w-3.5" /> Cancel
      </Button>
      {open && <ReviewPanel id={id} mode="REVERT" open onOpenChange={setOpen} />}
    </>
  );
}
