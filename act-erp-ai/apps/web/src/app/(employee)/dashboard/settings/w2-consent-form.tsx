"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toastAction } from "@/lib/toast-action";
import { consentToElectronicW2, withdrawW2Consent } from "@/server/actions/employees";

export function W2ConsentForm({ consented }: { consented: boolean }) {
  const [pending, startTransition] = useTransition();

  function give() {
    startTransition(async () => {
      const res = await consentToElectronicW2();
      if (!toastAction(res)) return;
      toast.success("Electronic W-2 delivery enabled");
    });
  }

  function withdraw() {
    startTransition(async () => {
      const res = await withdrawW2Consent();
      if (!toastAction(res)) return;
      toast.success("Reverted to paper W-2 delivery");
    });
  }

  if (consented) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="success" className="text-[10px]">Electronic delivery on</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Your W-2 will be delivered through this system instead of on paper.
          You can withdraw this at any time — a withdrawal takes effect
          immediately and does not affect any W-2 already provided.
        </p>
        <Button variant="outline" size="sm" onClick={withdraw} disabled={pending}>
          {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Withdraw consent — go back to paper
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>
          By default, your W-2 (annual tax statement) is delivered on paper,
          as required by federal law. You can instead choose to receive it
          electronically through this system.
        </p>
        <p>
          If you consent: you confirm you can access documents through this
          site (you&apos;re doing so right now) and are able to print or save
          your W-2 for your records. You may withdraw consent at any time in
          this Settings page — after withdrawing, your next W-2 will be
          delivered on paper. If you don&apos;t consent, or if your employment
          ends, you&apos;ll receive your W-2 on paper regardless.
        </p>
      </div>
      <Button size="sm" onClick={give} disabled={pending}>
        {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        I consent to electronic W-2 delivery
      </Button>
    </div>
  );
}
