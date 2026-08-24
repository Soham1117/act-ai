"use client";

import { useTransition } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toastAction } from "@/lib/toast-action";
import { markAllVerifiedToday } from "@/server/actions/benefits";

/** For after the annual broker audit — resets the freshness StatCard on
 * every employee's Benefits page in one click. */
export function MarkVerifiedButton() {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!confirm("Mark every currently-open enrollment and 401(k) election as verified today?")) return;
    startTransition(async () => {
      const res = await markAllVerifiedToday();
      if (!toastAction(res)) return;
      toast.success(`Marked verified: ${res.enrollments} enrollment(s), ${res.elections} election(s)`);
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={pending}>
      {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
      Mark all verified today
    </Button>
  );
}
