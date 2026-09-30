"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, MoreHorizontal, Play, RotateCcw, X } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toastAction } from "@/lib/toast-action";
import type { ActionResult } from "@/lib/action-result";
import { reopenRequest, updateRequestStatus } from "@/server/actions/requests";
import { REQUEST_TRANSITIONS, type RequestStatusKey } from "@/lib/request-transitions";

type Action = "PROCESSING" | "COMPLETED" | "REJECTED" | "REOPEN";

const COPY: Record<Action, { title: string; desc: string; confirm: string; required: boolean }> = {
  PROCESSING: { title: "Mark as processing", desc: "Optionally tell the employee what happens next.", confirm: "Mark processing", required: false },
  COMPLETED: { title: "Complete request", desc: "Optionally add a note for the employee.", confirm: "Complete", required: false },
  REJECTED: { title: "Reject request", desc: "A reason is required and is shown to the employee.", confirm: "Reject", required: true },
  REOPEN: { title: "Reopen request", desc: "Moves the request back to pending. A reason is required and is recorded.", confirm: "Reopen", required: true },
};

export function RequestStatusButtons({
  id,
  current,
}: {
  id: string;
  current: RequestStatusKey;
}) {
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const allowed = REQUEST_TRANSITIONS[current];
  const terminal = allowed.length === 0;
  const c = action ? COPY[action] : null;

  function run() {
    if (!action) return;
    startTransition(async () => {
      const res: ActionResult<Record<string, unknown>> =
        action === "REOPEN"
          ? await reopenRequest({ requestId: id, note })
          : await updateRequestStatus({ requestId: id, status: action, note: note.trim() || undefined });
      if (!toastAction(res)) return;
      toast.success(action === "REOPEN" ? "Reopened" : action.toLowerCase());
      setAction(null);
      setNote("");
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pending} aria-label="Request actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {allowed.includes("PROCESSING") && (
            <DropdownMenuItem onClick={() => setAction("PROCESSING")}>
              <Play className="mr-2 h-4 w-4" /> Mark processing
            </DropdownMenuItem>
          )}
          {allowed.includes("COMPLETED") && (
            <DropdownMenuItem onClick={() => setAction("COMPLETED")}>
              <Check className="mr-2 h-4 w-4" /> Complete
            </DropdownMenuItem>
          )}
          {allowed.includes("REJECTED") && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setAction("REJECTED")}
            >
              <X className="mr-2 h-4 w-4" /> Reject
            </DropdownMenuItem>
          )}
          {terminal && (
            <DropdownMenuItem onClick={() => setAction("REOPEN")}>
              <RotateCcw className="mr-2 h-4 w-4" /> Reopen
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{c?.title}</DialogTitle>
            <DialogDescription>{c?.desc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">{c?.required ? "Note (required)" : "Note (optional)"}</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>Close</Button>
            <Button
              variant={action === "REJECTED" ? "destructive" : "default"}
              disabled={pending || (!!c?.required && note.trim().length < 2)}
              onClick={run}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {c?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
