"use client";

import { useTransition } from "react";
import { Loader2, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toastAction } from "@/lib/toast-action";
import { deactivateBenefitPlan } from "@/server/actions/benefits";

/**
 * Deliberately no delete button anywhere in this UI. BenefitPlan.enrollments
 * uses onDelete: Restrict, so a plan with enrollment history can't be
 * deleted — deactivating removes it from new-enrollment pickers while
 * keeping history intact for the employees who were covered under it.
 */
export function DeactivatePlanButton({ planId, planName }: { planId: string; planName: string }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!confirm(`Deactivate "${planName}"? It stays visible on past coverage but can no longer be selected for new enrollments.`)) return;
    startTransition(async () => {
      const res = await deactivateBenefitPlan(planId);
      if (!toastAction(res)) return;
      toast.success("Plan deactivated");
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={pending}>
      {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <EyeOff className="mr-1.5 h-3.5 w-3.5" />}
      Deactivate
    </Button>
  );
}
