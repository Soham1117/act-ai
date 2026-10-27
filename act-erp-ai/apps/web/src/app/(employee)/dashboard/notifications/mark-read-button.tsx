"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAction } from "@/lib/toast-action";
import { markNotificationRead } from "@/server/actions/notifications";
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notification-events";
import { usePortalLanguage } from "@/components/portal-language";

export function MarkReadButton({ id }: { id: string }) {
  const { t, toastAction } = usePortalLanguage();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={pending}
      aria-label={t("notifications.markRead")}
      onClick={() =>
        startTransition(async () => {
          const res = await runAction(() => markNotificationRead(id));
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
