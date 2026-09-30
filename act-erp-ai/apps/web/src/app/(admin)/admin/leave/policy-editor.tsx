"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastAction } from "@/lib/toast-action";
import { saveLeavePolicies } from "@/server/actions/leave";
import type { AccrualMode, LeavePolicyValues } from "@/lib/leave-balance";

type Row = { leaveType: string } & LeavePolicyValues;

export function PolicyEditor({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();

  function patch(i: number, p: Partial<Row>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...p } : row)));
  }

  function save() {
    startTransition(async () => {
      const res = await saveLeavePolicies({
        policies: rows.map((r) => ({
          leaveType: r.leaveType as never,
          daysPerYear: Number(r.daysPerYear) || 0,
          unlimited: r.unlimited,
          accrualMode: r.accrualMode,
          carryoverMax: Number(r.carryoverMax) || 0,
        })),
      });
      if (!toastAction(res)) return;
      toast.success("Leave policy saved");
    });
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs text-muted-foreground">
        Each type has its own yearly allowance. Annual grant gives the full amount on Jan 1 (pro-rated by
        whole months in the hire year); monthly accrues one twelfth per completed month. Carryover is the
        most unused days moved into the next year (0 = use it or lose it). Changes apply to everyone immediately.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Unlimited</th>
              <th className="py-2 pr-3">Days / year</th>
              <th className="py-2 pr-3">Accrual</th>
              <th className="py-2 pr-3">Carryover max</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, i) => (
              <tr key={r.leaveType}>
                <td className="py-2 pr-3 font-medium">{r.leaveType}</td>
                <td className="py-2 pr-3">
                  <Checkbox
                    checked={r.unlimited}
                    onCheckedChange={(v) => patch(i, { unlimited: v === true })}
                    aria-label={`${r.leaveType} unlimited`}
                  />
                </td>
                <td className="py-2 pr-3">
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    step="0.5"
                    className="h-8 w-24"
                    disabled={r.unlimited}
                    value={r.daysPerYear}
                    onChange={(e) => patch(i, { daysPerYear: Number(e.target.value) })}
                  />
                </td>
                <td className="py-2 pr-3">
                  <Select
                    value={r.accrualMode}
                    onValueChange={(v) => patch(i, { accrualMode: v as AccrualMode })}
                    disabled={r.unlimited}
                  >
                    <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANNUAL_GRANT">Annual grant</SelectItem>
                      <SelectItem value="MONTHLY">Monthly accrual</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-2 pr-3">
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    step="0.5"
                    className="h-8 w-24"
                    disabled={r.unlimited}
                    value={r.carryoverMax}
                    onChange={(e) => patch(i, { carryoverMax: Number(e.target.value) })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button onClick={save} disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save policy
      </Button>
    </div>
  );
}
