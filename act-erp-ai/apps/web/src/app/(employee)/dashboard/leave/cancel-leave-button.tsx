"use client";

import { X } from "lucide-react";
import { toast } from "sonner";
import { InlineConfirmAction } from "@/components/inline-confirm-action";
import { runAction } from "@/lib/toast-action";
import { cancelLeaveRequest } from "@/server/actions/leave";
import { usePortalLanguage } from "@/components/portal-language";

export function CancelLeaveButton({ id, approved }: { id: string; approved?: boolean }) {
  const { t, toastAction } = usePortalLanguage();
  return (
    <InlineConfirmAction
      label={t("time.leave.cancelAria")}
      message={t(approved ? "time.leave.confirmApproved" : "time.leave.confirmPending")}
      cancelLabel={t("workspace.cancel")}
      onConfirm={async () => {
        const res = await runAction(() => cancelLeaveRequest(id));
        if (!toastAction(res)) return false;
        toast.success(t("time.leave.cancelled"));
        return true;
      }}
    >
      <X className="h-3.5 w-3.5" />
    </InlineConfirmAction>
  );
}
