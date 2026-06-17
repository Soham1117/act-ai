"use client";

import { useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { deleteDocument } from "@/server/actions/documents";

export function DeleteDocumentButton({
  id,
  title,
  className,
}: {
  id: string;
  title?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!confirm(`Delete${title ? ` "${title}"` : " this document"}? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        await deleteDocument(id);
        toast.success("Document deleted");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Delete"
      className={
        className ??
        "rounded-md border px-2 py-1 text-[10px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
      }
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
    </button>
  );
}
