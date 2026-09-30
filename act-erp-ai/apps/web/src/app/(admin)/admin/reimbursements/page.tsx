import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Receipt } from "lucide-react";
import { businessDateOnly, formatCurrency, formatDateOnly, getAvatarUrl } from "@/lib/format";
import { businessYearRange, type ReimbursementStatus } from "@/lib/reimbursement";
import { ReceiptLinks } from "@/components/receipt-links";
import { ReimbursementStatusButtons } from "./reimbursement-status-buttons";

export const metadata = { title: "Reimbursements" };

const PAGE_SIZE = 50;

const include = {
  employee: { select: { name: true, email: true, profilePic: true } },
  receipts: { select: { id: true, originalName: true } },
} as const;

export default async function AdminReimbursementsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const tab = ["pending", "under-review", "approved", "all"].includes(sp.tab ?? "") ? sp.tab! : "pending";

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const year = businessDateOnly().getUTCFullYear();
  const { start, end } = businessYearRange(year);

  const [pending, underReview, approved, all, allCount, approvedUnpaid, paidYtd] = await Promise.all([
    safe(db.reimbursement.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, include }), []),
    safe(db.reimbursement.findMany({ where: { status: "UNDER_REVIEW" }, orderBy: { createdAt: "asc" }, include }), []),
    safe(db.reimbursement.findMany({ where: { status: "APPROVED" }, orderBy: { approvalDate: "desc" }, include }), []),
    safe(
      db.reimbursement.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include,
      }),
      [],
    ),
    safe(db.reimbursement.count(), 0),
    safe(
      db.reimbursement.aggregate({ where: { status: "APPROVED" }, _sum: { amount: true } }),
      { _sum: { amount: null } },
    ),
    safe(
      db.reimbursement.aggregate({
        where: { status: "PAID", paidDate: { gte: start, lt: end } },
        _sum: { paidAmount: true },
      }),
      { _sum: { paidAmount: null } },
    ),
  ]);

  const totalPages = Math.max(1, Math.ceil(allCount / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Reimbursements" description="Approve, reject, mark paid." />
      <div className="grid gap-3 sm:grid-cols-5">
        <StatCard label="Pending" value={pending.length} icon={<Receipt className="h-4 w-4 text-primary" />} />
        <StatCard label="Under review" value={underReview.length} />
        <StatCard label="Awaiting payment" value={approved.length} />
        <StatCard label="Approved, unpaid" value={formatCurrency(Number(approvedUnpaid._sum.amount ?? 0))} />
        <StatCard label={`Paid ${year}`} value={formatCurrency(Number(paidYtd._sum.paidAmount ?? 0))} />
      </div>

      <Tabs defaultValue={tab} className="mt-6 space-y-4">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="under-review">Under review ({underReview.length})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
          <TabsTrigger value="all">All ({allCount})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending"><RList rows={pending} /></TabsContent>
        <TabsContent value="under-review"><RList rows={underReview} /></TabsContent>
        <TabsContent value="approved"><RList rows={approved} /></TabsContent>
        <TabsContent value="all">
          <RList rows={all} />
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`?tab=all&page=${page - 1}`}>Previous</Link>
                  </Button>
                )}
                {page < totalPages && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`?tab=all&page=${page + 1}`}>Next</Link>
                  </Button>
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

type R = {
  id: string;
  title: string;
  category: string;
  amount: unknown;
  paidAmount: unknown;
  currency: string;
  status: ReimbursementStatus;
  expenseDate: Date;
  createdAt: Date;
  reviewNotes: string | null;
  description: string;
  employee: { name: string; email: string | null; profilePic: string | null };
  receipts: { id: string; originalName: string }[];
};

function RList({ rows }: { rows: R[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="grid h-32 place-items-center text-xs text-muted-foreground">
          Nothing here.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y">
          {rows.map((r) => {
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
                <div className="grid grid-cols-[36px_1fr_auto_auto_auto] items-center gap-3">
                  <span className="relative h-9 w-9 overflow-hidden rounded-full bg-muted">
                    <Image src={r.employee.profilePic ?? getAvatarUrl(r.employee.email)} alt={r.employee.name} fill sizes="36px" className="object-cover" unoptimized />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {r.employee.name} · {r.category.replace(/_/g, " ")} · {formatDateOnly(r.expenseDate)}
                    </p>
                  </div>
                  <span className="text-right font-mono text-sm tabular-nums">
                    {formatCurrency(amount, r.currency)}
                    {paid !== null && paid !== amount && (
                      <span className="block text-[10px] text-muted-foreground">paid {formatCurrency(paid, r.currency)}</span>
                    )}
                  </span>
                  <Badge variant={variant} className="text-[10px]">{r.status.replace("_", " ")}</Badge>
                  <div className="w-8">
                    <ReimbursementStatusButtons id={r.id} current={r.status} amount={amount} />
                  </div>
                </div>
                <div className="ml-12 space-y-1">
                  <p className="text-[11px] text-muted-foreground">{r.description}</p>
                  {r.reviewNotes && (
                    <p className="text-[11px]">
                      <span className="font-medium">{r.status === "REJECTED" ? "Rejection reason: " : "Review note: "}</span>
                      {r.reviewNotes}
                    </p>
                  )}
                  <ReceiptLinks receipts={r.receipts} />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
