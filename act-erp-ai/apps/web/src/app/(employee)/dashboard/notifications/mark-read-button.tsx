"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toastAction } from "@/lib/toast-action";
import { markNotificationRead } from "@/server/actions/notifications";

export function MarkReadButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await markNotificationRead(id);
          toastAction(res);
        })
      }
    >
      <Check className="h-3.5 w-3.5" />
    </Button>
  );
}
