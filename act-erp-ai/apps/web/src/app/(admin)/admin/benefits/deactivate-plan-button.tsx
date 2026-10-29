"use client";
import { EyeOff } from "lucide-react";
import { toast } from "sonner";
import { InlineConfirmAction } from "@/components/inline-confirm-action";
import { runAction, toastAction } from "@/lib/toast-action";
import { deactivateBenefitPlan } from "@/server/actions/benefits";

export function DeactivatePlanButton({
  planId,
  planName,
}: {
  planId: string;
  planName: string;
}) {
  return (
    <InlineConfirmAction
      label="Deactivate"
      cancelLabel="Cancel"
      variant="outline"
      message={`Deactivate "${planName}"? It stays visible on past coverage but can no longer be selected for new enrollments.`}
      onConfirm={async () => {
        const res = await runAction(() => deactivateBenefitPlan(planId));
        if (!toastAction(res)) return false;
        toast.success("Plan deactivated");
        return true;
      }}
    >
      <EyeOff className="mr-1.5 h-3.5 w-3.5" />
      Deactivate
    </InlineConfirmAction>
  );
}
