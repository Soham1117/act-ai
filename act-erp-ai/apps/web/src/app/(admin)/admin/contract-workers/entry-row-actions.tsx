"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PenLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { dateToBusinessLocal } from "@/lib/time-rules";
import {
  adminDeleteContractTimeEntry,
  adminEditContractTimeEntry,
} from "@/server/actions/contract-workers";

export type ContractEntryActionRow = {
  id: string;
  workerName: string;
  clockIn: string;
  clockOut: string | null;
  isOpen: boolean;
};

export function ContractEntryRowActions({
  entry,
  panelSlotId,
  size = "sm",
}: {
  entry: ContractEntryActionRow;
  /** Must match a PanelSlot / PanelSlotRow id next to this row. */
  panelSlotId: string;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [reason, setReason] = useState("");

  function openEdit() {
    if (pending) return;
    setClockIn(dateToBusinessLocal(new Date(entry.clockIn)));
    setClockOut(entry.clockOut ? dateToBusinessLocal(new Date(entry.clockOut)) : "");
    setReason("");
    setDeleteOpen(false);
    setEditOpen(true);
  }

  function openDelete() {
    if (pending) return;
    setReason("");
    setEditOpen(false);
    setDeleteOpen(true);
  }

  function saveEdit() {
    if (!clockIn) return toast.error("Enter a clock-in time.");
    if (!entry.isOpen && !clockOut) {
      return toast.error("Enter a clock-out time for this closed entry.");
    }
    if (reason.trim().length < 3) {
      return toast.error("Enter a reason (at least 3 characters).");
    }
    startTransition(async () => {
      const res = await runAction(() =>
        adminEditContractTimeEntry({
          id: entry.id,
          clockIn,
          clockOut: clockOut.trim(),
          reason: reason.trim(),
        }),
      );
      if (!toastAction(res)) return;
      if (entry.isOpen && !clockOut) {
        toast.success("Clock-in updated. The shift is still open.");
      } else if (entry.isOpen && clockOut) {
        toast.success("Shift closed with the new times. Pending approval.");
      } else {
        toast.success("Times updated. The entry is pending approval again.");
      }
      setEditOpen(false);
      router.refresh();
    });
  }

  function confirmDelete() {
    if (reason.trim().length < 3) {
      return toast.error("Enter a reason (at least 3 characters).");
    }
    startTransition(async () => {
      const res = await runAction(() =>
        adminDeleteContractTimeEntry({ id: entry.id, reason: reason.trim() }),
      );
      if (!toastAction(res)) return;
      toast.success("Entry deleted.");
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap justify-end gap-1">
        <Button
          type="button"
          size={size}
          variant="ghost"
          disabled={pending}
          onClick={openEdit}
        >
          <PenLine className="mr-1 h-3.5 w-3.5" />
          Edit times
        </Button>
        <Button
          type="button"
          size={size}
          variant="ghost"
          disabled={pending}
          onClick={openDelete}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      <InlinePanel
        open={editOpen}
        onOpenChange={(v) => !pending && !v && setEditOpen(false)}
      >
        <InlinePanelContent panelSlot={panelSlotId}>
          <InlinePanelHeader>
            <InlinePanelTitle>Edit times for {entry.workerName}</InlinePanelTitle>
            <InlinePanelDescription>
              {entry.isOpen
                ? "Times are Central. Leave clock-out empty to keep the shift open, or set one to close it (pending approval). Breaks are kept."
                : "Times are Central. Breaks are kept. After saving, the entry is pending approval again."}
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`cw-edit-in-${entry.id}`}>Clock in</Label>
              <Input
                id={`cw-edit-in-${entry.id}`}
                type="datetime-local"
                value={clockIn}
                onChange={(e) => setClockIn(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`cw-edit-out-${entry.id}`}>
                Clock out{entry.isOpen ? " (optional)" : ""}
              </Label>
              <Input
                id={`cw-edit-out-${entry.id}`}
                type="datetime-local"
                value={clockOut}
                onChange={(e) => setClockOut(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`cw-edit-reason-${entry.id}`}>
                Reason (saved in the audit log)
              </Label>
              <Textarea
                id={`cw-edit-reason-${entry.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>
          <InlinePanelFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={saveEdit} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save times
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>

      <InlinePanel
        open={deleteOpen}
        onOpenChange={(v) => !pending && !v && setDeleteOpen(false)}
      >
        <InlinePanelContent panelSlot={panelSlotId}>
          <InlinePanelHeader>
            <InlinePanelTitle>Delete entry for {entry.workerName}?</InlinePanelTitle>
            <InlinePanelDescription>
              This permanently removes the time entry. It cannot be undone. A reason is
              required for the audit log.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="space-y-1">
            <Label htmlFor={`cw-del-reason-${entry.id}`}>Reason</Label>
            <Textarea
              id={`cw-del-reason-${entry.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
          <InlinePanelFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={pending || reason.trim().length < 3}
            >
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Delete entry
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>
    </>
  );
}
