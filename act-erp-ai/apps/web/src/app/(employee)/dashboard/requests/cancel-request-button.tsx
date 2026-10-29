"use client";

import { toast } from "sonner";
import { InlineConfirmAction } from "@/components/inline-confirm-action";
import { runAction } from "@/lib/toast-action";
import { cancelRequest } from "@/server/actions/requests";
import { usePortalLanguage } from "@/components/portal-language";

export function CancelRequestButton({ id }: { id: string }) {
  const { t, toastAction } = usePortalLanguage();
  return (
    <InlineConfirmAction
      label={t("workspace.requests.withdraw")}
      message={t("workspace.requests.withdrawConfirm")}
      cancelLabel={t("workspace.cancel")}
      onConfirm={async () => {
        const res = await runAction(() => cancelRequest(id));
        if (!toastAction(res)) return false;
        toast.success(t("workspace.requests.withdrawnToast"));
        return true;
      }}
    >
      {t("workspace.requests.withdraw")}
    </InlineConfirmAction>
  );
}
