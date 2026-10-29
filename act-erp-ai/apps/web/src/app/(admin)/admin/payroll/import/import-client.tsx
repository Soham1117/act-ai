"use client";

import { useRouter } from "next/navigation";
import { BatchPaystubsPanel } from "../batch-paystubs-panel";

type EmployeeOption = { id: string; name: string; inactive?: boolean };

export function PaystubImportClient({ employees }: { employees: EmployeeOption[] }) {
  const router = useRouter();

  return (
    <div className="mt-4 space-y-4">
      <BatchPaystubsPanel
        employees={employees}
        onClose={() => router.push("/admin/payroll")}
        onSavingChange={() => undefined}
        onHasRowsChange={() => undefined}
      />
    </div>
  );
}
