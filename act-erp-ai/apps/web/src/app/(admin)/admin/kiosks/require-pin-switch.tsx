"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  InlinePanel,
  InlinePanelAction,
  InlinePanelCancel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
} from "@/components/inline-panel";
import { setKioskRequirePin } from "@/server/actions/kiosk";
import { runAction, toastAction } from "@/lib/toast-action";

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
      const res = await runAction(() => setKioskRequirePin(id, next));
      if (!toastAction(res)) return;
      toast.success(next ? "PIN is now required at this kiosk" : "PIN is no longer required");
      setConfirmOff(false);
    });
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
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

      <InlinePanel disabled={pending} open={confirmOff} onOpenChange={setConfirmOff}>
        <InlinePanelContent>
          <InlinePanelHeader>
            <InlinePanelTitle>Turn off the PIN at {label}?</InlinePanelTitle>
            <InlinePanelDescription>
              Workers will pick their name and punch without a PIN. A photo is taken at every
              clock in and clock out, and photos are kept for 30 days. You can turn the PIN back
              on at any time.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <InlinePanelFooter>
            <InlinePanelCancel disabled={pending}>Cancel</InlinePanelCancel>
            <InlinePanelAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                save(false);
              }}
            >
              Turn off PIN
            </InlinePanelAction>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>
    </div>
  );
}
