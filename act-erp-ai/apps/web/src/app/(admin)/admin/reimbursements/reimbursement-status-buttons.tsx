"use client";

import { useState, useTransition } from "react";
import { Check, MoreHorizontal, DollarSign, Eye, Loader2, RotateCcw, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toastAction } from "@/lib/toast-action";
import { reopenReimbursement, reviewReimbursement } from "@/server/actions/reimbursements";
import { allowedTransitions, canReopen, type ReimbursementStatus } from "@/lib/reimbursement";

type Dlg = null | "reject" | "pay" | "reopen";

export function ReimbursementStatusButtons({
  id,
  current,
  amount,
}: {
  id: string;
  current: ReimbursementStatus;
  amount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dlg>(null);
  const [note, setNote] = useState("");
  const [paid, setPaid] = useState(amount.toFixed(2));

  const next = allowedTransitions(current);
  const reopenable = canReopen(current);
  if (next.length === 0 && !reopenable) return null;

  function closeDialog() {
    setDialog(null);
    setNote("");
    setPaid(amount.toFixed(2));
  }

  function review(status: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "PAID") {
    startTransition(async () => {
      const res = await reviewReimbursement({
        reimbursementId: id,
        status,
        note: note.trim() || undefined,
        paidAmount: status === "PAID" ? Number(paid) : undefined,
      });
      if (!toastAction(res)) return;
      toast.success(status.replace("_", " ").toLowerCase());
      closeDialog();
    });
  }

  function reopen() {
    startTransition(async () => {
      const res = await reopenReimbursement({ reimbursementId: id, note: note.trim() || undefined });
      if (!toastAction(res)) return;
      toast.success("Claim reopened");
      closeDialog();
    });
  }

  const paidNum = Number(paid);
  const partial = Number.isFinite(paidNum) && paidNum > 0 && paidNum < amount;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pending} aria-label="Review actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {next.includes("UNDER_REVIEW") && (
            <DropdownMenuItem onClick={() => review("UNDER_REVIEW")}>
              <Eye className="mr-2 h-4 w-4" /> Under review
            </DropdownMenuItem>
          )}
          {next.includes("APPROVED") && (
            <DropdownMenuItem onClick={() => review("APPROVED")}>
              <Check className="mr-2 h-4 w-4" /> Approve
            </DropdownMenuItem>
          )}
          {next.includes("PAID") && (
            <DropdownMenuItem onClick={() => setDialog("pay")}>
              <DollarSign className="mr-2 h-4 w-4" /> Mark paid
            </DropdownMenuItem>
          )}
          {next.includes("REJECTED") && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDialog("reject")}
            >
              <X className="mr-2 h-4 w-4" /> Reject
            </DropdownMenuItem>
          )}
          {reopenable && (
            <DropdownMenuItem onClick={() => setDialog("reopen")}>
              <RotateCcw className="mr-2 h-4 w-4" /> Reopen
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog === "reject"} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject claim</DialogTitle>
            <DialogDescription>The employee will see this reason and be notified.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason (required)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button variant="destructive" disabled={pending || !note.trim()} onClick={() => review("REJECTED")}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "pay"} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark paid</DialogTitle>
            <DialogDescription>
              Claimed amount ${amount.toFixed(2)}. Paying less closes the claim as a partial payment and needs a note.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount paid</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={amount}
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Note {partial ? "(required for a partial payment)" : "(optional)"}</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              disabled={pending || !(paidNum > 0) || paidNum > amount || (partial && !note.trim())}
              onClick={() => review("PAID")}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "reopen"} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen claim</DialogTitle>
            <DialogDescription>
              Puts the claim back to Pending for another review. This is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button disabled={pending} onClick={reopen}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reopen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
