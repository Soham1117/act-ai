"use client";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { InlineConfirmAction } from "@/components/inline-confirm-action";
import { runAction, toastAction } from "@/lib/toast-action";
import { resetEmployeeKioskPin } from "@/server/actions/kiosk";

export function ResetKioskPinButton({ employeeId }: { employeeId: string }) {
  return <InlineConfirmAction label="Reset kiosk PIN" message="Reset this employee's kiosk PIN to the temporary default 3214?" cancelLabel="Cancel" variant="outline" onConfirm={async () => {
    const res = await runAction(() => resetEmployeeKioskPin(employeeId));
    if (!toastAction(res)) return false;
    toast.success("Kiosk PIN reset to 3214");
    return true;
  }}><KeyRound className="mr-1.5 h-3.5 w-3.5" />Reset kiosk PIN</InlineConfirmAction>;
}
