"use client";

import { useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { runAction } from "@/lib/toast-action";
import { deleteDocument } from "@/server/actions/documents";
import { usePortalLanguage } from "@/components/portal-language";

export function DeleteDocumentButton({
  id,
  title,
  className,
}: {
  id: string;
  title?: string;
  className?: string;
}) {
  const { t, toastAction } = usePortalLanguage();
  const [pending, startTransition] = useTransition();

  function onClick() {
    const confirmation = title
      ? t("documentControls.delete.confirmWithTitle", { title })
      : t("documentControls.delete.confirm");
    if (!confirm(confirmation)) return;
    startTransition(async () => {
      const res = await runAction(() => deleteDocument(id));
      if (!toastAction(res)) return;
      toast.success(t("documentControls.delete.success"));
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={t("documentControls.delete.action")}
      aria-label={t("documentControls.delete.action")}
      className={
        className ??
        "rounded-md border px-2 py-1 text-[10px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
      }
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
    </button>
  );
}
