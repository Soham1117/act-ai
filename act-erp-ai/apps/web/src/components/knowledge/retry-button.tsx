"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toastAction } from "@/lib/toast-action";
import { retryKnowledgeDocument } from "@/server/actions/knowledge";
import { Button } from "@/components/ui/button";

export function KnowledgeRetryButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="mt-1 h-6 px-2 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await retryKnowledgeDocument(documentId);
          if (!toastAction(res)) return;
          toast.success("Retry queued");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Retrying…" : "Retry"}
    </Button>
  );
}
