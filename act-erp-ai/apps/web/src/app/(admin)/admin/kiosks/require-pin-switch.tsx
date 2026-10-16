"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { setKioskRequirePin } from "@/server/actions/kiosk";
import { toastAction } from "@/lib/toast-action";

export function RequirePinSwitch({
  id,
  label,
  requirePin,
}: {
  id: string;
  label: string;
  requirePin: boolean;
}) {
  const switchId = useId();
  const [pending, startTransition] = useTransition();
  const [confirmOff, setConfirmOff] = useState(false);

  function save(next: boolean) {
    startTransition(async () => {
      const res = await setKioskRequirePin(id, next);
      if (!toastAction(res)) return;
      toast.success(next ? "PIN is now required at this kiosk" : "PIN is no longer required");
      setConfirmOff(false);
    });
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={requirePin}
          disabled={pending}
          onCheckedChange={(next) => (next ? save(true) : setConfirmOff(true))}
        />
        <Label htmlFor={switchId} className="text-xs font-medium">
          Require PIN for employees
        </Label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Off: workers just pick their name; a photo is taken at each punch. On: workers also type
        their PIN.
      </p>

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off the PIN at {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Workers will pick their name and punch without a PIN. A photo is taken at every
              clock in and clock out, and photos are kept for 30 days. You can turn the PIN back
              on at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                save(false);
              }}
            >
              Turn off PIN
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
