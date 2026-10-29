"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BatchPaystubsPanel } from "../batch-paystubs-panel";

type CalendarPeriod = {
  id: string;
  title: string;
  payPeriodStart: Date;
  payPeriodEnd: Date;
};
type EmployeeOption = { id: string; name: string };

export function PaystubImportClient({
  calendarPeriods,
  employees,
}: {
  calendarPeriods: CalendarPeriod[];
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [periodId, setPeriodId] = useState(calendarPeriods[0]?.id ?? "");
  const [hasRows, setHasRows] = useState(false);
  const selectedPeriod = calendarPeriods.find((period) => period.id === periodId) ?? null;

  return (
    <div className="mt-4 space-y-4">
      <div className="max-w-md space-y-1.5">
        <Label htmlFor="paystub-import-period">Pay period</Label>
        <Select
          value={periodId}
          onValueChange={setPeriodId}
          disabled={hasRows || calendarPeriods.length === 0}
        >
          <SelectTrigger id="paystub-import-period">
            <SelectValue placeholder="Select a pay period" />
          </SelectTrigger>
          <SelectContent>
            {calendarPeriods.map((period) => (
              <SelectItem key={period.id} value={period.id}>
                {period.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!calendarPeriods.length && (
          <p className="text-sm text-destructive">
            Create a pay period on the Payroll page before importing stubs.
          </p>
        )}
      </div>
      <BatchPaystubsPanel
        employees={employees}
        selectedPeriod={selectedPeriod}
        onClose={() => router.push("/admin/payroll")}
        onSavingChange={() => undefined}
        onHasRowsChange={setHasRows}
      />
    </div>
  );
}
