"use client";

import { useTransition } from "react";
import { Check, MoreHorizontal, DollarSign, Eye, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { reviewReimbursement } from "@/server/actions/reimbursements";

type Status = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "PAID";

export function ReimbursementStatusButtons({
  id,
  current,
  amount,
}: {
  id: string;
  current: Status;
  amount: number;
}) {
  const [pending, startTransition] = useTransition();
  function run(status: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "PAID") {
    startTransition(async () => {
      try {
        await reviewReimbursement({
          reimbursementId: id,
          status,
          paidAmount: status === "PAID" ? amount : undefined,
        });
        toast.success(status.replace("_", " "));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed");
      }
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
          <DropdownMenuItem onClick={() => run("UNDER_REVIEW")}>
            <Eye className="mr-2 h-4 w-4" /> Under review
          </DropdownMenuItem>
        )}
        {(current === "PENDING" || current === "UNDER_REVIEW") && (
          <DropdownMenuItem onClick={() => run("APPROVED")}>
            <Check className="mr-2 h-4 w-4" /> Approve
          </DropdownMenuItem>
        )}
        {current === "APPROVED" && (
          <DropdownMenuItem onClick={() => run("PAID")}>
            <DollarSign className="mr-2 h-4 w-4" /> Mark paid
          </DropdownMenuItem>
        )}
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
