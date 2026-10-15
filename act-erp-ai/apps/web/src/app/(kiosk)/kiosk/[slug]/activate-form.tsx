"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MonitorCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toastAction, toastCaught } from "@/lib/toast-action";
import { activateKiosk, trustCurrentNetworkAndActivate } from "@/server/actions/kiosk";

export function ActivateForm({ slug, kioskLabel }: { slug: string; kioskLabel?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deniedIp, setDeniedIp] = useState<string | null | undefined>(undefined);

  function onActivate() {
    startTransition(() => {
      void (async () => {
        try {
          const res = await activateKiosk(slug);
          if (!res.ok && "networkDenied" in res) {
            setDeniedIp(res.ip);
            toast.error(res.error);
            return;
          }
          if (!toastAction(res)) return;
          setDeniedIp(undefined);
          toast.success("Kiosk activated on this device.");
          router.refresh();
          router.push(res.redirectTo);
        } catch (err) {
          toastCaught(err);
        }
      })();
    });
  }

  function onTrustAndActivate() {
    startTransition(() => {
      void (async () => {
        try {
          const res = await trustCurrentNetworkAndActivate(slug);
          if (!toastAction(res)) return;
          toast.success("Network trusted and kiosk activated on this device.");
          router.refresh();
          router.push(res.redirectTo);
        } catch (err) {
          toastCaught(err);
        }
      })();
    });
  }

  return (
    <div className="space-y-3">
      <Button className="h-11 w-full" disabled={pending} onClick={onActivate}>
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <MonitorCheck className="mr-2 h-4 w-4" />
        )}
        Activate kiosk on this device
      </Button>

      {deniedIp !== undefined && (
        <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <p>
            This connection appears as{" "}
            <span className="font-mono font-medium">{deniedIp ?? "unknown"}</span>, which is not
            an approved network.
          </p>
          <p className="text-muted-foreground">
            Only do this if this device is physically at{" "}
            <span className="font-medium">{kioskLabel ?? slug}</span>. Other admins will be
            notified.
          </p>
          <Button
            variant="outline"
            className="h-10 w-full"
            disabled={pending || !deniedIp}
            onClick={onTrustAndActivate}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            Trust this network and activate
          </Button>
        </div>
      )}
    </div>
  );
}
