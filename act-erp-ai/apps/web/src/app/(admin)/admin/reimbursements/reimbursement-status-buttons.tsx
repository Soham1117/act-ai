"use client";

import { useId, useState, useTransition } from "react";
import {
  Check,
  MoreHorizontal,
  DollarSign,
  Eye,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
} from "@/components/inline-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { runAction, toastAction } from "@/lib/toast-action";
import {
  reopenReimbursement,
  reviewReimbursement,
} from "@/server/actions/reimbursements";
import {
  allowedTransitions,
  canReopen,
  type ReimbursementStatus,
} from "@/lib/reimbursement";

type ReviewPanel = null | "reject" | "pay" | "reopen";

export function ReimbursementStatusButtons({
  id,
  current,
  amount,
}: {
  id: string;
  current: ReimbursementStatus;
  amount: number;
}) {
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const [panel, setPanel] = useState<ReviewPanel>(null);
  const [note, setNote] = useState("");
  const [paid, setPaid] = useState(amount.toFixed(2));

  const next = allowedTransitions(current);
  const reopenable = canReopen(current);
  if (next.length === 0 && !reopenable) return null;

  function closePanel() {
    setPanel(null);
    setNote("");
    setPaid(amount.toFixed(2));
  }

  function review(status: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "PAID") {
    startTransition(async () => {
      const res = await runAction(() =>
        reviewReimbursement({
          reimbursementId: id,
          status,
          note: note.trim() || undefined,
          paidAmount: status === "PAID" ? Number(paid) : undefined,
        }),
      );
      if (!toastAction(res)) return;
      toast.success(status.replace("_", " ").toLowerCase());
      closePanel();
    });
  }

  function reopen() {
    startTransition(async () => {
      const res = await runAction(() =>
        reopenReimbursement({ reimbursementId: id, note: note.trim() || undefined }),
      );
      if (!toastAction(res)) return;
      toast.success("Claim reopened");
      closePanel();
    });
  }

  const paidNum = Number(paid);
  const partial = Number.isFinite(paidNum) && paidNum > 0 && paidNum < amount;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 md:h-9 md:w-9"
            disabled={pending}
            aria-label="Review actions"
          >
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
            <DropdownMenuItem onClick={() => setPanel("pay")}>
              <DollarSign className="mr-2 h-4 w-4" /> Mark paid
            </DropdownMenuItem>
          )}
          {next.includes("REJECTED") && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setPanel("reject")}
            >
              <X className="mr-2 h-4 w-4" /> Reject
            </DropdownMenuItem>
          )}
          {reopenable && (
            <DropdownMenuItem onClick={() => setPanel("reopen")}>
              <RotateCcw className="mr-2 h-4 w-4" /> Reopen
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <InlinePanel open={panel === "reject"} onOpenChange={(o) => !o && closePanel()}>
        <InlinePanelContent panelSlot={`reimb-${id}`}>
          <InlinePanelHeader>
            <InlinePanelTitle>Reject claim</InlinePanelTitle>
            <InlinePanelDescription>
              The employee will see this reason and be notified.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-field-0`} className="text-xs">
              Reason (required)
            </Label>
            <Textarea
              id={`${formId}-field-0`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </div>
          <InlinePanelFooter>
            <Button variant="outline" disabled={pending} onClick={closePanel}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending || !note.trim()}
              onClick={() => review("REJECTED")}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject claim
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>

      <InlinePanel open={panel === "pay"} onOpenChange={(o) => !o && closePanel()}>
        <InlinePanelContent panelSlot={`reimb-${id}`}>
          <InlinePanelHeader>
            <InlinePanelTitle>Mark paid</InlinePanelTitle>
            <InlinePanelDescription>
              Claimed amount ${amount.toFixed(2)}. Paying less closes the claim as a
              partial payment and needs a note.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="min-w-0 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-field-1`} className="text-xs">
                Amount paid
              </Label>
              <Input
                id={`${formId}-field-1`}
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
              <Label htmlFor={`${formId}-field-2`} className="text-xs">
                Note {partial ? "(required for a partial payment)" : "(optional)"}
              </Label>
              <Textarea
                id={`${formId}-field-2`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={1000}
              />
            </div>
          </div>
          <InlinePanelFooter>
            <Button variant="outline" disabled={pending} onClick={closePanel}>
              Cancel
            </Button>
            <Button
              disabled={
                pending || !(paidNum > 0) || paidNum > amount || (partial && !note.trim())
              }
              onClick={() => review("PAID")}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mark paid
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>

      <InlinePanel open={panel === "reopen"} onOpenChange={(o) => !o && closePanel()}>
        <InlinePanelContent panelSlot={`reimb-${id}`}>
          <InlinePanelHeader>
            <InlinePanelTitle>Reopen claim</InlinePanelTitle>
            <InlinePanelDescription>
              Puts the claim back to Pending for another review. This is recorded in the
              audit log.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-field-3`} className="text-xs">
              Note (optional)
            </Label>
            <Textarea
              id={`${formId}-field-3`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
            />
          </div>
          <InlinePanelFooter>
            <Button variant="outline" disabled={pending} onClick={closePanel}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={reopen}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reopen
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>
    </>
  );
}
