"use client";

import { useRouter } from "next/navigation";
import { LoadingButton } from "@/components/interior/loading-button";
import { bulkReviewTimeEntries } from "@/server/actions/time-clock";
import { runAction, toastAction } from "@/lib/toast-action";
import { toast } from "sonner";

export function GroupHoursApproveBar({ ids }: { ids: string[] }) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm">
      <span className="text-amber-800 dark:text-amber-300">
        {ids.length} pending entr{ids.length === 1 ? "y" : "ies"} in this view
      </span>
      <LoadingButton
        className="h-8 shrink-0 border-transparent bg-primary text-primary-foreground"
        disabled={ids.length === 0}
        pendingLabel="Approving…"
        successLabel="Approved"
        errorLabel="Failed"
        onAction={async () => {
          const res = await runAction(() =>
            bulkReviewTimeEntries({ ids, decision: "APPROVED" }),
          );
          if (!toastAction(res) || !res.ok) {
            throw new Error(res.ok ? "Approve failed" : res.error);
          }
          toast.success(`Approved ${res.updated}`);
          router.refresh();
        }}
      >
        Approve all pending in range
      </LoadingButton>
    </div>
  );
}
