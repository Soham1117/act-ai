import Image from "next/image";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Receipt } from "lucide-react";
import { formatCurrency, getAvatarUrl } from "@/lib/format";
import { ReimbursementStatusButtons } from "./reimbursement-status-buttons";

export const metadata = { title: "Reimbursements" };

export default async function AdminReimbursementsPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [pending, underReview, approved, all, stats] = await Promise.all([
    safe(
      db.reimbursement.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        include: { employee: { select: { name: true, email: true, profilePic: true } } },
      }),
      [],
    ),
    safe(
      db.reimbursement.findMany({
        where: { status: "UNDER_REVIEW" },
        orderBy: { createdAt: "asc" },
        include: { employee: { select: { name: true, email: true, profilePic: true } } },
      }),
      [],
    ),
    safe(
      db.reimbursement.findMany({
        where: { status: "APPROVED" },
        orderBy: { approvalDate: "desc" },
        include: { employee: { select: { name: true, email: true, profilePic: true } } },
      }),
      [],
    ),
    safe(
      db.reimbursement.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { employee: { select: { name: true, email: true, profilePic: true } } },
      }),
      [],
    ),
    safe(
      db.reimbursement.aggregate({
        _sum: { amount: true, paidAmount: true },
        _count: { _all: true },
      }),
      { _sum: { amount: null, paidAmount: null }, _count: { _all: 0 } },
    ),
  ]);

  return (
    <>
      <PageHeader title="Reimbursements" description="Approve, reject, mark paid." />
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Pending" value={pending.length} icon={<Receipt className="h-4 w-4 text-primary" />} />
        <StatCard label="Under review" value={underReview.length} />
        <StatCard label="Awaiting payment" value={approved.length} />
        <StatCard label="Paid YTD" value={formatCurrency(Number(stats._sum.paidAmount ?? 0))} />
      </div>

      <Tabs defaultValue="pending" className="mt-6 space-y-4">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="under-review">Under review ({underReview.length})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
        <TabsContent value="pending"><RList rows={pending} /></TabsContent>
        <TabsContent value="under-review"><RList rows={underReview} /></TabsContent>
        <TabsContent value="approved"><RList rows={approved} /></TabsContent>
        <TabsContent value="all"><RList rows={all} /></TabsContent>
      </Tabs>
    </>
  );
}

type R = {
  id: string;
  title: string;
  category: string;
  amount: unknown;
  currency: string;
  status: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "PAID";
  expenseDate: Date;
  createdAt: Date;
  employee: { name: string; email: string | null; profilePic: string | null };
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
            return (
              <li key={r.id} className="grid grid-cols-[36px_1fr_auto_auto_auto] items-center gap-3 p-3">
                <span className="relative h-9 w-9 overflow-hidden rounded-full bg-muted">
                  <Image src={r.employee.profilePic ?? getAvatarUrl(r.employee.email)} alt={r.employee.name} fill sizes="36px" className="object-cover" unoptimized />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {r.employee.name} · {r.category.replace(/_/g, " ")} · {r.expenseDate.toLocaleDateString()}
                  </p>
                </div>
                <span className="font-mono text-sm tabular-nums">{formatCurrency(Number(r.amount), r.currency)}</span>
                <Badge variant={variant} className="text-[10px]">{r.status.replace("_", " ")}</Badge>
                {(r.status === "PENDING" || r.status === "UNDER_REVIEW" || r.status === "APPROVED") && (
                  <ReimbursementStatusButtons id={r.id} current={r.status} amount={Number(r.amount)} />
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
