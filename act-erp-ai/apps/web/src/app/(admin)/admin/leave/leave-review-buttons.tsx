"use client";

import { useTransition } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reviewLeave } from "@/server/actions/leave";

export function LeaveReviewButtons({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  function run(decision: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      try {
        await reviewLeave({ requestId: id, decision });
        toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed");
      }
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
