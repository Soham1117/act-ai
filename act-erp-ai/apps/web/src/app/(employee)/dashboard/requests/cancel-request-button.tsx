"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toastAction } from "@/lib/toast-action";
import { cancelRequest } from "@/server/actions/requests";

export function CancelRequestButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[11px]"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Withdraw this request?")) return;
        startTransition(async () => {
          const res = await cancelRequest(id);
          if (!toastAction(res)) return;
          toast.success("Request withdrawn");
        });
      }}
    >
      Withdraw
    </Button>
  );
}
