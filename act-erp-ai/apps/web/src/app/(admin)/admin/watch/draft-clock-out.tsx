"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createClockOutProposal } from "@/server/actions/watch-proposals";

export function DraftClockOut({ findingId }: { findingId: string }) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Draft clock-out correction</Button>;
  return (
    <div className="max-w-xl space-y-2 rounded-md border p-3">
      <p className="text-sm">Use the scheduled end as a draft for review. Creating a draft changes no hours. Shifts with an open break need a manual correction.</p>
      <label htmlFor={id} className="block text-sm font-medium">Reason for correction</label>
      <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || reason.trim().length < 3} onClick={() => start(async () => {
          const result = await createClockOutProposal({ findingId, reason });
          if (!result.ok) return void toast.error(result.error);
          toast.success("Draft ready for review. No hours changed.");
          router.push("/admin/watch/proposals");
          router.refresh();
        })}>{pending ? "Creating…" : "Create draft"}</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" variant="ghost" asChild><Link href="/admin/watch/proposals">View drafts</Link></Button>
      </div>
    </div>
  );
}
