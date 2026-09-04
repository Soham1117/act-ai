"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toastAction } from "@/lib/toast-action";
import { consentToBenefitsEDelivery, withdrawBenefitsEConsent } from "@/server/actions/employees";

export function BenefitsConsentForm({ consented }: { consented: boolean }) {
  const router = useRouter();
  const [isConsented, setIsConsented] = useState(consented);
  const [pending, startTransition] = useTransition();

  function give() {
    startTransition(async () => {
      const res = await consentToBenefitsEDelivery();
      if (!toastAction(res)) return;
      setIsConsented(true);
      toast.success("Electronic benefits document delivery enabled");
      router.refresh();
    });
  }

  function withdraw() {
    startTransition(async () => {
      const res = await withdrawBenefitsEConsent();
      if (!toastAction(res)) return;
      setIsConsented(false);
      toast.success("Reverted to paper delivery for benefits documents");
      router.refresh();
    });
  }

  if (isConsented) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          <Badge variant="success" className="gap-1 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Consented — electronic delivery on
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Health & welfare plan documents (SPDs, summaries of material modifications, benefit
          summaries) can be delivered through this system instead of on paper. You can withdraw
          this at any time — a withdrawal takes effect immediately.
        </p>
        <Button variant="outline" size="sm" onClick={withdraw} disabled={pending}>
          {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {pending ? "Withdrawing consent…" : "Withdraw consent — go back to paper"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>
          By default, benefits plan documents (SPDs, summaries of material modifications, benefit
          summaries) are delivered on paper. You can instead choose to receive them electronically
          through this system.
        </p>
        <p>
          This does not cover your own coverage details (tier, member ID, cost) shown on the
          Benefits page — that&apos;s always available regardless of this setting. It only governs
          formal plan documents your employer is required to furnish. You may withdraw consent at
          any time in this Settings page.
        </p>
      </div>
      <Button size="sm" onClick={give} disabled={pending}>
        {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        {pending ? "Saving consent…" : "I consent to electronic benefits document delivery"}
      </Button>
    </div>
  );
}
