"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runAction } from "@/lib/toast-action";
import { cancelRequest } from "@/server/actions/requests";
import { usePortalLanguage } from "@/components/portal-language";

export function CancelRequestButton({ id }: { id: string }) {
  const { t, toastAction } = usePortalLanguage();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[11px]"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(t("workspace.requests.withdrawConfirm"))) return;
        startTransition(async () => {
          const res = await runAction(() => cancelRequest(id));
          if (!toastAction(res)) return;
          toast.success(t("workspace.requests.withdrawnToast"));
        });
      }}
    >
      {t("workspace.requests.withdraw")}
    </Button>
  );
}
