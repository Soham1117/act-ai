"use client";

import { useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generatePayrollSlipCsv } from "./actions";

export function DownloadCsvButton({
  periodId,
  title,
}: {
  periodId: string;
  title: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const csv = await generatePayrollSlipCsv(periodId);
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `payroll-slip-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("CSV downloaded");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
          }
        })
      }
    >
      {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
      Download CSV
    </Button>
  );
}
