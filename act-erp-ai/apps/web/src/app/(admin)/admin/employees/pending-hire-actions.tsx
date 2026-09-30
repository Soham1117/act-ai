"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
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
import { toastAction } from "@/lib/toast-action";
import { approveEmployee, rejectPendingHire } from "@/server/actions/employees";

/** Approve / reject a self-onboarded hire that is awaiting review. */
export function PendingHireActions({
  employeeId,
  name,
  redirectTo,
}: {
  employeeId: string;
  name: string;
  /** Where to go after rejecting (the detail page no longer exists). */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmReject, setConfirmReject] = useState(false);

  return (
    <>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await approveEmployee(employeeId);
              if (!toastAction(res)) return;
              toast.success(`${name} approved`);
              router.refresh();
            })
          }
        >
          {pending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1.5 h-3.5 w-3.5" />
          )}
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setConfirmReject(true)}
        >
          <X className="mr-1.5 h-3.5 w-3.5" /> Reject
        </Button>
      </div>
      <Dialog open={confirmReject} onOpenChange={setConfirmReject}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject {name}?</DialogTitle>
            <DialogDescription>
              This deletes their account and everything they submitted (details and uploaded
              documents). They can be invited again with a new link.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReject(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await rejectPendingHire(employeeId);
                  if (!toastAction(res)) return;
                  toast.success(`${name} rejected`);
                  setConfirmReject(false);
                  if (redirectTo) router.push(redirectTo);
                  else router.refresh();
                })
              }
            >
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Reject and delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
