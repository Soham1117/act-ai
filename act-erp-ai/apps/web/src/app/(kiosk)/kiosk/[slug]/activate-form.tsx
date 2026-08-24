"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MonitorCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toastAction, toastCaught } from "@/lib/toast-action";
import { activateKiosk } from "@/server/actions/kiosk";

export function ActivateForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onActivate() {
    startTransition(() => {
      void (async () => {
        try {
          const res = await activateKiosk(slug);
          if (!toastAction(res)) return;
          toast.success("Kiosk activated on this device.");
          router.refresh();
          router.push(res.redirectTo);
        } catch (err) {
          toastCaught(err);
        }
      })();
    });
  }

  return (
    <Button className="h-11 w-full" disabled={pending} onClick={onActivate}>
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <MonitorCheck className="mr-2 h-4 w-4" />
      )}
      Activate kiosk on this device
    </Button>
  );
}
