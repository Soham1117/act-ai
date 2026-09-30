"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toastAction } from "@/lib/toast-action";
import { cancelLeaveRequest } from "@/server/actions/leave";

export function CancelLeaveButton({ id, approved }: { id: string; approved?: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label="Cancel leave request"
      title="Cancel request"
      onClick={() => {
        const msg = approved
          ? "Cancel this approved leave? Your days will be returned to your balance."
          : "Cancel this leave request?";
        if (!window.confirm(msg)) return;
        startTransition(async () => {
          const res = await cancelLeaveRequest(id);
          if (!toastAction(res)) return;
          toast.success("Cancelled");
        });
      }}
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  );
}
