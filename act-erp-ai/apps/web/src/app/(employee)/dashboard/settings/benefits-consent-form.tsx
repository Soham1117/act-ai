"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runAction } from "@/lib/toast-action";
import {
  consentToBenefitsEDelivery,
  withdrawBenefitsEConsent,
} from "@/server/actions/employees";
import { usePortalLanguage } from "@/components/portal-language";

export function BenefitsConsentForm({ consented }: { consented: boolean }) {
  const { t, toastAction } = usePortalLanguage();
  const router = useRouter();
  const [isConsented, setIsConsented] = useState(consented);
  const [pending, startTransition] = useTransition();

  function give() {
    startTransition(async () => {
      const res = await runAction(() => consentToBenefitsEDelivery());
      if (!toastAction(res)) return;
      setIsConsented(true);
      toast.success(t("account.benefits.enabled"));
      router.refresh();
    });
  }

  function withdraw() {
    startTransition(async () => {
      const res = await runAction(() => withdrawBenefitsEConsent());
      if (!toastAction(res)) return;
      setIsConsented(false);
      toast.success(t("account.benefits.withdrawn"));
      router.refresh();
    });
  }

  if (isConsented) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          <Badge variant="success" className="gap-1 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t("account.consent.enabledBadge")}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("account.benefits.enabledDescription")}
        </p>
        <Button variant="outline" size="sm" onClick={withdraw} disabled={pending}>
          {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {pending
            ? t("account.consent.withdrawing")
            : t("account.consent.withdrawToPaper")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>{t("account.benefits.defaultDescription")}</p>
        <p>{t("account.benefits.consentDescription")}</p>
      </div>
      <Button size="sm" onClick={give} disabled={pending}>
        {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        {pending ? t("account.consent.saving") : t("account.benefits.giveConsent")}
      </Button>
    </div>
  );
}
