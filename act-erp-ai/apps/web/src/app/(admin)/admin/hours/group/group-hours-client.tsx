"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { bulkReviewTimeEntries } from "@/server/actions/time-clock";
import { runAction, toastAction } from "@/lib/toast-action";
import { toast } from "sonner";

export function GroupHoursApproveBar({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
      <span className="text-amber-800 dark:text-amber-300">
        {ids.length} pending entr{ids.length === 1 ? "y" : "ies"} in this view
      </span>
      <Button
        type="button"
        size="sm"
        disabled={pending || ids.length === 0}
        onClick={() => {
          start(async () => {
            const res = await runAction(() =>
              bulkReviewTimeEntries({ ids, decision: "APPROVED" }),
            );
            if (!toastAction(res)) return;
            toast.success(`Approved ${res.ok ? res.updated : 0}`);
            router.refresh();
          });
        }}
      >
        Approve all pending in range
      </Button>
    </div>
  );
}
