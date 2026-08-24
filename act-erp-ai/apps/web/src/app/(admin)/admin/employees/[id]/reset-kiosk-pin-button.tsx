"use client";

import { useTransition } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toastAction } from "@/lib/toast-action";
import { resetEmployeeKioskPin } from "@/server/actions/kiosk";

export function ResetKioskPinButton({ employeeId }: { employeeId: string }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!confirm("Clear this employee's kiosk PIN? They'll need to set a new one in Settings before clocking in/out at a kiosk again.")) return;
    startTransition(async () => {
      const res = await resetEmployeeKioskPin(employeeId);
      if (!toastAction(res)) return;
      toast.success("Kiosk PIN cleared");
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="mr-1.5 h-3.5 w-3.5" />}
      Reset kiosk PIN
    </Button>
  );
}
