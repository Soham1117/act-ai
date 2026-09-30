"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toastAction } from "@/lib/toast-action";
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

function ReviewDialog({
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
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState("");
  const [override, setOverride] = useState(false);
  const c = COPY[mode];
  const missing = (c.required || (mode === "APPROVE" && override)) && notes.trim().length === 0;

  function run() {
    startTransition(async () => {
      const res: ActionResult<Record<string, unknown>> =
        mode === "REVERT"
          ? await cancelLeaveRequest(id, notes)
          : await reviewLeave({
              requestId: id,
              decision: mode === "APPROVE" ? "APPROVED" : "REJECTED",
              notes: notes.trim() || undefined,
              overrideBalance: mode === "APPROVE" ? override : undefined,
            });
      if (!toastAction(res)) return;
      toast.success(mode === "APPROVE" ? "Approved" : mode === "REJECT" ? "Rejected" : "Leave cancelled");
      onOpenChange(false);
      setNotes("");
      setOverride(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>{c.desc}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              {c.required ? "Reason (required)" : override ? "Override reason (required)" : "Note (optional)"}
            </Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} />
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            variant={mode === "APPROVE" ? "success" : "destructive"}
            disabled={pending || missing}
            onClick={run}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {c.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveReviewButtons({ id }: { id: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="destructive" onClick={() => setMode("REJECT")} aria-label="Reject">
        <X className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="success" onClick={() => setMode("APPROVE")}>
        <Check className="h-4 w-4" /> Approve
      </Button>
      {mode && (
        <ReviewDialog id={id} mode={mode} open onOpenChange={(o) => !o && setMode(null)} />
      )}
    </div>
  );
}

/** Admin revert of an APPROVED (or pending) leave. */
export function LeaveRevertButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title="Cancel this approved leave">
        <Undo2 className="mr-1 h-3.5 w-3.5" /> Cancel
      </Button>
      {open && <ReviewDialog id={id} mode="REVERT" open onOpenChange={setOpen} />}
    </>
  );
}
