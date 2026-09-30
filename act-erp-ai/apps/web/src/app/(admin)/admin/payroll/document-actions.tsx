"use client";

import { useTransition } from "react";
import { Download, Eye, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deletePayrollDocument } from "@/server/actions/payroll";
import { toastAction } from "@/lib/toast-action";

export function PayrollDocumentActions({ id, title }: { id: string; title: string }) {
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (!confirm(`Delete "${title}"? The file is removed permanently and the employee will no longer see it.`)) return;
    startTransition(async () => {
      const res = await deletePayrollDocument(id);
      if (!toastAction(res)) return;
      toast.success("Payroll document deleted");
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Button size="icon" variant="ghost" className="h-7 w-7" asChild aria-label="View document">
        <a href={`/api/payroll/${id}/file`} target="_blank" rel="noopener noreferrer">
          <Eye className="h-3.5 w-3.5" />
        </a>
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" asChild aria-label="Download document">
        <a href={`/api/payroll/${id}/file?download=1`}>
          <Download className="h-3.5 w-3.5" />
        </a>
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onDelete} disabled={pending} aria-label="Delete document">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
