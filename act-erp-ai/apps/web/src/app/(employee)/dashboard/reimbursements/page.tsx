import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Receipt } from "lucide-react";
import { businessDateOnly, formatCurrency, formatDateOnly } from "@/lib/format";
import { businessYearRange } from "@/lib/reimbursement";
import { ReceiptLinks } from "@/components/receipt-links";
import { ReimbursementDialog } from "./reimbursement-dialog";

export const metadata = { title: "Reimbursements" };

const PAGE_SIZE = 25;

export default async function EmployeeReimbursementsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  if (!user.employeeId) return <p className="text-sm text-muted-foreground">No employee record.</p>;
  const employeeId = user.employeeId;
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const year = businessDateOnly().getUTCFullYear();
  const { start, end } = businessYearRange(year);

  const [records, total, pendingAgg, approvedAgg, paidAgg] = await Promise.all([
    safe(
      db.reimbursement.findMany({
        where: { employeeId },
        orderBy: { createdAt: "desc" },
        include: {
          receipts: { select: { id: true, originalName: true } },
          history: { orderBy: { updatedAt: "asc" }, select: { id: true, status: true, note: true, updatedAt: true } },
        },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      [],
    ),
    safe(db.reimbursement.count({ where: { employeeId } }), 0),
    safe(
      db.reimbursement.aggregate({
        where: { employeeId, status: { in: ["PENDING", "UNDER_REVIEW"] } },
        _sum: { amount: true },
      }),
      { _sum: { amount: null } },
    ),
    safe(
      db.reimbursement.aggregate({ where: { employeeId, status: "APPROVED" }, _sum: { amount: true } }),
      { _sum: { amount: null } },
    ),
    safe(
      db.reimbursement.aggregate({
        where: { employeeId, status: "PAID", paidDate: { gte: start, lt: end } },
        _sum: { paidAmount: true },
      }),
      { _sum: { paidAmount: null } },
    ),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const readOnly = user.accessLevel !== "FULL";

  return (
    <>
      <PageHeader
        title="Reimbursements"
        description="Submit and track expense claims."
        actions={readOnly ? undefined : <ReimbursementDialog />}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total claims" value={total} icon={<Receipt className="h-4 w-4" />} />
        <StatCard label="Pending review" value={formatCurrency(Number(pendingAgg._sum.amount ?? 0))} />
        <StatCard label="Approved, unpaid" value={formatCurrency(Number(approvedAgg._sum.amount ?? 0))} />
        <StatCard label={`Paid ${year}`} value={formatCurrency(Number(paidAgg._sum.paidAmount ?? 0))} />
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
              const amount = Number(r.amount);
              const paid = r.paidAmount === null ? null : Number(r.paidAmount);
              return (
                <li key={r.id} className="space-y-2 p-3">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3">
                    <div>
                      <p className="text-sm font-medium">{r.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {r.category.replace(/_/g, " ")} · {formatDateOnly(r.expenseDate)}
                      </p>
                    </div>
                    <span className="text-right font-mono text-sm tabular-nums">
                      {formatCurrency(amount, r.currency)}
                      {paid !== null && paid !== amount && (
                        <span className="block text-[10px] text-muted-foreground">paid {formatCurrency(paid, r.currency)}</span>
                      )}
                    </span>
                    <Badge variant={variant} className="text-[10px]">{r.status.replace("_", " ")}</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {r.createdAt.toLocaleDateString()}
                    </span>
                  </div>
                  {r.reviewNotes && (
                    <p
                      className={`rounded-md border p-2 text-xs ${
                        r.status === "REJECTED" ? "border-destructive/40 bg-destructive/5" : "bg-muted/40"
                      }`}
                    >
                      <span className="font-medium">
                        {r.status === "REJECTED" ? "Rejection reason: " : "Note from reviewer: "}
                      </span>
                      {r.reviewNotes}
                    </p>
                  )}
                  <ReceiptLinks receipts={r.receipts} />
                  <details className="text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer select-none">History ({r.history.length})</summary>
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {r.history.map((h) => (
                        <li key={h.id}>
                          {h.updatedAt.toLocaleDateString()} · {h.status.replace("_", " ")}
                          {h.note ? ` — ${h.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild size="sm" variant="outline">
                <Link href={`?page=${page - 1}`}>Previous</Link>
              </Button>
            )}
            {page < totalPages && (
              <Button asChild size="sm" variant="outline">
                <Link href={`?page=${page + 1}`}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
