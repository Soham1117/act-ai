import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Receipt } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { ReimbursementDialog } from "./reimbursement-dialog";

export const metadata = { title: "Reimbursements" };

export default async function EmployeeReimbursementsPage() {
  const user = await requireUser();
  if (!user.employeeId) return <p className="text-sm text-muted-foreground">No employee record.</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const records = await safe(
    db.reimbursement.findMany({
      where: { employeeId: user.employeeId },
      orderBy: { createdAt: "desc" },
      include: { receipts: true },
      take: 100,
    }),
    [],
  );

  const totalPending = records
    .filter((r) => ["PENDING", "UNDER_REVIEW"].includes(r.status))
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const totalPaid = records
    .filter((r) => r.status === "PAID")
    .reduce((sum, r) => sum + Number(r.paidAmount ?? r.amount), 0);

  return (
    <>
      <PageHeader
        title="Reimbursements"
        description="Submit and track expense claims."
        actions={<ReimbursementDialog />}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total claims" value={records.length} icon={<Receipt className="h-4 w-4" />} />
        <StatCard label="Pending review" value={formatCurrency(totalPending)} />
        <StatCard label="Paid YTD" value={formatCurrency(totalPaid)} />
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">My claims</CardTitle></CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {records.length === 0 && (
              <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                No claims yet.
              </li>
            )}
            {records.map((r) => {
              const variant =
                r.status === "PAID" ? "success" :
                r.status === "REJECTED" ? "destructive" :
                r.status === "APPROVED" ? "success" :
                r.status === "UNDER_REVIEW" ? "warning" :
                r.status === "PENDING" ? "warning" : "outline";
              return (
                <li key={r.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 p-3">
                  <div>
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.category.replace(/_/g, " ")} · {r.expenseDate.toLocaleDateString()} · {r.receipts.length} receipt(s)
                    </p>
                  </div>
                  <span className="font-mono text-sm tabular-nums">{formatCurrency(Number(r.amount), r.currency)}</span>
                  <Badge variant={variant} className="text-[10px]">{r.status.replace("_", " ")}</Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {r.createdAt.toLocaleDateString()}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
