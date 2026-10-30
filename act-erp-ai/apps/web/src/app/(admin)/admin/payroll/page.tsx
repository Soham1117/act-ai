import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { CreatePayrollPeriodForm } from "./create-period-form";
import { PeriodActions } from "./period-actions";
import { PERIOD_STATE_LABEL, periodState, type PeriodState } from "@/lib/payroll-period";
import { loadPeriodCounts } from "@/server/payroll-close";
import { PanelSlot } from "@/components/inline-panel";
import { PeriodClose } from "./period-close";
import { formatDateOnly } from "@/lib/format";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export const metadata = { title: "Payroll" };

const BADGE: Record<PeriodState, "outline" | "warning" | "success" | "secondary"> = {
  UPCOMING: "outline",
  CURRENT: "warning",
  REVIEW: "warning",
  READY: "success",
  CLOSED: "secondary",
};

export default async function AdminPayrollPage() {
  const rawCalendar = await db.payrollCalendar
    .findMany({ orderBy: { payDate: "desc" } })
    .catch(() => []);

  const [counts, closers] = await Promise.all([
    loadPeriodCounts(rawCalendar).catch(() => new Map<string, { pending: number; open: number }>()),
    db.user
      .findMany({
        where: { id: { in: rawCalendar.flatMap((p) => (p.closedById ? [p.closedById] : [])) } },
        select: { id: true, name: true },
      })
      .catch(() => []),
  ]);
  const closerName = new Map(closers.map((u) => [u.id, u.name]));
  const calendar = rawCalendar.map((p) => {
    const c = counts.get(p.id) ?? { pending: 0, open: 0 };
    return {
      ...p,
      ...c,
      state: periodState({
        start: p.payPeriodStart,
        end: p.payPeriodEnd,
        closedAt: p.closedAt,
        pending: c.pending,
        open: c.open,
      }),
    };
  });
  const count = (state: PeriodState) => calendar.filter((p) => p.state === state).length;

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Upload pay stubs and pay periods are created for you from the dates printed on them."
        actions={
          <Button asChild>
            <Link href="/admin/payroll/import">
              <Upload className="mr-1.5 h-4 w-4" />
              Upload pay stubs
            </Link>
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="In progress" value={count("CURRENT") + count("UPCOMING")} />
        <StatCard label="Needs review" value={count("REVIEW")} />
        <StatCard label="Ready to export" value={count("READY")} />
        <StatCard label="Closed" value={count("CLOSED")} />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">Pay periods ({calendar.length})</CardTitle>
            <CardDescription>
              Used for hours exports. After a period ends, approve its hours, export them, then
              close it to lock the hours. Add a period by hand only if you need one before its pay
              stubs exist.
            </CardDescription>
          </div>
          <CreatePayrollPeriodForm />
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {calendar.length === 0 && (
              <li className="grid h-32 place-items-center px-4 text-center text-xs text-muted-foreground">
                No pay periods yet. Upload pay stubs and they appear here.
              </li>
            )}
            {calendar.map((p) => {
              const closedNote =
                p.closedAt && p.state === "CLOSED"
                  ? `Closed${p.closedById && closerName.get(p.closedById) ? ` by ${closerName.get(p.closedById)}` : ""} on ${formatDateOnly(p.closedAt)}`
                  : null;
              return (
                <li key={p.id} className="flex min-w-0 flex-col gap-2 p-3 transition-colors hover:bg-muted/50">
                  <Link
                    href={`/admin/payroll/${p.id}`}
                    className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-3 sm:p-3 sm:pl-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{p.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatDateOnly(p.payPeriodStart)} → {formatDateOnly(p.payPeriodEnd)}
                      </p>
                    </div>
                    <span className="font-mono text-xs">Pay {formatDateOnly(p.payDate)}</span>
                    <Badge variant={BADGE[p.state]} className="text-[10px]">{PERIOD_STATE_LABEL[p.state]}</Badge>
                    <span className="text-[10px] text-muted-foreground">View hours →</span>
                  </Link>
                  <PeriodClose
                    id={p.id}
                    title={p.title}
                    state={p.state}
                    pending={p.pending}
                    open={p.open}
                    closedNote={closedNote}
                  />
                  <PeriodActions
                    period={{
                      id: p.id,
                      title: p.title,
                      payPeriodStart: iso(p.payPeriodStart),
                      payPeriodEnd: iso(p.payPeriodEnd),
                      payDate: iso(p.payDate),
                      notes: p.notes,
                      completedOverride: p.status === "COMPLETED",
                    }}
                  />
                  <PanelSlot id={`period-${p.id}`} />
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
