"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { InlineConfirmAction } from "@/components/inline-confirm-action";
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
  return (
    <InlineConfirmAction
      label={t("documentControls.delete.action")}
      message={
        title
          ? t("documentControls.delete.confirmWithTitle", { title })
          : t("documentControls.delete.confirm")
      }
      cancelLabel={t("workspace.cancel")}
      variant="outline"
      className={className ?? "min-h-11 min-w-11 text-destructive md:min-h-9 md:min-w-9"}
      onConfirm={async () => {
        const res = await runAction(() => deleteDocument(id));
        if (!toastAction(res)) return false;
        toast.success(t("documentControls.delete.success"));
        return true;
      }}
    >
      <Trash2 className="h-4 w-4" />
    </InlineConfirmAction>
  );
}
