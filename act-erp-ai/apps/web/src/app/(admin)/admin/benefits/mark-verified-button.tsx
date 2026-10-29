"use client";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { InlineConfirmAction } from "@/components/inline-confirm-action";
import { runAction, toastAction } from "@/lib/toast-action";
import { markAllVerifiedToday } from "@/server/actions/benefits";

export function MarkVerifiedButton() {
  return (
    <InlineConfirmAction
      label="Mark all verified today"
      cancelLabel="Cancel"
      variant="outline"
      message="Mark every currently-open enrollment and 401(k) election as verified today?"
      onConfirm={async () => {
        const res = await runAction(() => markAllVerifiedToday());
        if (!toastAction(res)) return false;
        toast.success(
          `Marked verified: ${res.enrollments} enrollment(s), ${res.elections} election(s)`,
        );
        return true;
      }}
    >
      <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
      Mark all verified today
    </InlineConfirmAction>
  );
}
