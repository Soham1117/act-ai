"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runAction } from "@/lib/toast-action";
import { cancelLeaveRequest } from "@/server/actions/leave";
import { usePortalLanguage } from "@/components/portal-language";

export function CancelLeaveButton({ id, approved }: { id: string; approved?: boolean }) {
  const { t, toastAction } = usePortalLanguage();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={t("time.leave.cancelAria")}
      title={t("time.leave.cancelTitle")}
      onClick={() => {
        const msg = approved
          ? t("time.leave.confirmApproved")
          : t("time.leave.confirmPending");
        if (!window.confirm(msg)) return;
        startTransition(async () => {
          const res = await runAction(() => cancelLeaveRequest(id));
          if (!toastAction(res)) return;
          toast.success(t("time.leave.cancelled"));
        });
      }}
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  );
}
