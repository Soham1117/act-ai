"use client";

import { useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runAction, toastAction } from "@/lib/toast-action";
import { exportIndividualEmployeeHours } from "@/server/actions/individual-hours-export";

export function DownloadEmployeeHoursButton({
  employeeId,
  from,
  to,
}: {
  employeeId: string;
  from: string;
  to: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-9 w-full sm:ml-auto sm:w-auto"
      disabled={pending}
      onClick={(event) => {
        const data = event.currentTarget.form
          ? new FormData(event.currentTarget.form)
          : null;
        const input = {
          employeeId,
          from: String(data?.get("from") ?? from),
          to: String(data?.get("to") ?? to),
        };
        start(async () => {
          const result = await runAction(() => exportIndividualEmployeeHours(input));
          if (!toastAction(result)) return;
          if (!result.xlsx) {
            toast.info("No entries in this range, so there is nothing to export.");
            return;
          }
          const blob = new Blob(
            [Uint8Array.from(atob(result.xlsx), (c) => c.charCodeAt(0))],
            { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
          );
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = result.filename;
          link.click();
          URL.revokeObjectURL(url);
          toast.success("Excel downloaded");
        });
      }}
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
      )}
      Download Excel
    </Button>
  );
}
