"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MonitorCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toastAction } from "@/lib/toast-action";
import { activateKiosk } from "@/server/actions/kiosk";

export function ActivateForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      className="h-11 w-full"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await activateKiosk(slug);
          if (!toastAction(res)) return;
          // Cookie was set by the server action; refresh + navigate so the
          // kiosk terminal sees the active session on the same browser.
          router.refresh();
          router.push(res.redirectTo);
        });
      }}
    >
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <MonitorCheck className="mr-2 h-4 w-4" />
      )}
      Activate kiosk on this device
    </Button>
  );
}
