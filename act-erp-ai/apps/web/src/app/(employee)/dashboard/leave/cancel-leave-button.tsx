"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toastAction } from "@/lib/toast-action";
import { cancelLeaveRequest } from "@/server/actions/leave";

export function CancelLeaveButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await cancelLeaveRequest(id);
          if (!toastAction(res)) return;
          toast.success("Cancelled");
        })
      }
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  );
}
