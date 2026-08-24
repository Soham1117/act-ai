"use client";

import { useTransition } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toastAction } from "@/lib/toast-action";
import { reviewLeave } from "@/server/actions/leave";

export function LeaveReviewButtons({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  function run(decision: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      const res = await reviewLeave({ requestId: id, decision });
      if (!toastAction(res)) return;
      toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
    });
  }
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => run("REJECTED")}>
        <X className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="success" disabled={pending} onClick={() => run("APPROVED")}>
        <Check className="h-4 w-4" /> Approve
      </Button>
    </div>
  );
}
