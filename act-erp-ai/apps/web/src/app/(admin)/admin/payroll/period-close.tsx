"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
  InlinePanelTrigger,
} from "@/components/inline-panel";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { closePayrollPeriod, reopenPayrollPeriod } from "@/server/actions/payroll";
import { runAction, toastAction } from "@/lib/toast-action";

export type PeriodCloseProps = {
  id: string;
  title: string;
  state: "UPCOMING" | "CURRENT" | "REVIEW" | "READY" | "CLOSED";
  pending: number;
  open: number;
  /** "Closed by Name on Oct 30, 2026", only when closed. */
  closedNote: string | null;
};

/** Close a finished period once its hours are exported, or reopen it. */
export function PeriodClose({ id, title, state, pending, open, closedNote }: PeriodCloseProps) {
  const formId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, startTransition] = useTransition();

  if (state === "REVIEW") {
    return (
      <p className="text-xs text-muted-foreground">
        {pending > 0 && `${pending} ${pending === 1 ? "entry needs" : "entries need"} approval`}
        {pending > 0 && open > 0 && " · "}
        {open > 0 && `${open} still clocked in`}
        {". "}
        <Link href="/admin/time-tracking?tab=pending" className="underline underline-offset-2">
          Review hours
        </Link>
      </p>
    );
  }
  if (state !== "READY" && state !== "CLOSED") return null;

  const closed = state === "CLOSED";

  function run() {
    startTransition(async () => {
      const res = await runAction(() =>
        closed ? reopenPayrollPeriod(id, reason) : closePayrollPeriod(id),
      );
      if (!toastAction(res)) return;
      toast.success(closed ? "Period reopened" : "Period closed");
      setIsOpen(false);
      setReason("");
    });
  }

  return (
    <InlinePanel open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex flex-wrap items-center gap-2">
        <InlinePanelTrigger asChild disabled={busy}>
          <Button size="sm" variant={closed ? "outline" : "default"}>
            {closed ? (
              <LockOpen className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Lock className="mr-1.5 h-3.5 w-3.5" />
            )}
            {closed ? "Reopen" : "Close period"}
          </Button>
        </InlinePanelTrigger>
        {closedNote && <span className="text-xs text-muted-foreground">{closedNote}</span>}
      </div>
      <InlinePanelContent panelSlot={`period-${id}`}>
        <InlinePanelHeader>
          <InlinePanelTitle>{closed ? `Reopen ${title}?` : `Close ${title}?`}</InlinePanelTitle>
          <InlinePanelDescription>
            {closed
              ? "Hours in this period can be edited and approved again. Re-export afterwards if anything changes."
              : "Do this after you have exported the hours. Admins can no longer edit, add, delete or approve hours in this period until it is reopened. Kiosk punches are not affected."}
          </InlinePanelDescription>
        </InlinePanelHeader>
        {closed && (
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-reason`} className="text-xs">
              Reason (required, audited)
            </Label>
            <Textarea
              id={`${formId}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
        )}
        <InlinePanelFooter>
          <Button variant="outline" disabled={busy} onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || (closed && reason.trim().length < 3)} onClick={run}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {closed ? "Reopen period" : "Close period"}
          </Button>
        </InlinePanelFooter>
      </InlinePanelContent>
    </InlinePanel>
  );
}
