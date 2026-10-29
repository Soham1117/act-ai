"use client";

import { Download, Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InlineConfirmAction } from "@/components/inline-confirm-action";
import { deletePayrollDocument } from "@/server/actions/payroll";
import { runAction, toastAction } from "@/lib/toast-action";

export function PayrollDocumentActions({ id, title }: { id: string; title: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        className="h-11 w-11 md:h-9 md:w-9"
        asChild
        aria-label="View document"
      >
        <a href={`/api/payroll/${id}/file`} target="_blank" rel="noopener noreferrer">
          <Eye className="h-3.5 w-3.5" />
        </a>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-11 w-11 md:h-9 md:w-9"
        asChild
        aria-label="Download document"
      >
        <a href={`/api/payroll/${id}/file?download=1`}>
          <Download className="h-3.5 w-3.5" />
        </a>
      </Button>
      <InlineConfirmAction
        label="Delete document"
        message={`Delete "${title}"? The file is removed permanently and the employee will no longer see it.`}
        cancelLabel="Keep document"
        className="min-h-11 min-w-11 text-destructive md:min-h-9 md:min-w-9"
        onConfirm={async () => {
          const res = await runAction(() => deletePayrollDocument(id));
          if (!toastAction(res)) return false;
          toast.success("Payroll document deleted");
          return true;
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </InlineConfirmAction>
    </div>
  );
}
