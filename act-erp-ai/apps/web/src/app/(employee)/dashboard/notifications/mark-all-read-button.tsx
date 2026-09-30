"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toastAction } from "@/lib/toast-action";
import { markAllNotificationsRead } from "@/server/actions/notifications";
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notification-events";

export function MarkAllReadButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await markAllNotificationsRead();
          if (!toastAction(res)) return;
          window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
          router.refresh();
          toast.success("Marked all read");
        })
      }
    >
      <CheckCheck className="mr-2 h-3.5 w-3.5" /> Mark all read
    </Button>
  );
}
