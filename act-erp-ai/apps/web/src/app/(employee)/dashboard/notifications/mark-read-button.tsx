"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toastAction } from "@/lib/toast-action";
import { markNotificationRead } from "@/server/actions/notifications";
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notification-events";

export function MarkReadButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={pending}
      aria-label="Mark as read"
      onClick={() =>
        startTransition(async () => {
          const res = await markNotificationRead(id);
          if (!toastAction(res)) return;
          window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
          router.refresh();
        })
      }
    >
      <Check className="h-3.5 w-3.5" />
    </Button>
  );
}
