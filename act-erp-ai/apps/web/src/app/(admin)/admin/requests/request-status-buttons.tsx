"use client";

import { useTransition } from "react";
import { Check, MoreHorizontal, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toastAction } from "@/lib/toast-action";
import { updateRequestStatus } from "@/server/actions/requests";

export function RequestStatusButtons({
  id,
  current,
}: {
  id: string;
  current: "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED";
}) {
  const [pending, startTransition] = useTransition();
  function run(status: "PROCESSING" | "COMPLETED" | "REJECTED") {
    startTransition(async () => {
      const res = await updateRequestStatus({ requestId: id, status });
      if (!toastAction(res)) return;
      toast.success(status);
    });
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pending}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {current === "PENDING" && (
          <DropdownMenuItem onClick={() => run("PROCESSING")}>
            <Play className="mr-2 h-4 w-4" /> Mark processing
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => run("COMPLETED")}>
          <Check className="mr-2 h-4 w-4" /> Complete
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => run("REJECTED")}
        >
          <X className="mr-2 h-4 w-4" /> Reject
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
