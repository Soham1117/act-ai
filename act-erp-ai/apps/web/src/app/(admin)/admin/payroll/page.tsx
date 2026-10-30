import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { CreatePayrollPeriodForm } from "./create-period-form";
import { PeriodActions } from "./period-actions";
import { derivePeriodStatus, effectivePeriodStatus, type PeriodStatus } from "@/lib/payroll-period";
import { formatDateOnly } from "@/lib/format";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export const metadata = { title: "Payroll" };

/** Plain-language label for a period's state. "Closed early" = marked done before its end date. */
function periodLabel(shown: PeriodStatus, stored: PeriodStatus, start: Date, end: Date) {
  if (shown === "UPCOMING") return { text: "Not started", variant: "outline" as const };
  if (shown === "CURRENT") return { text: "In progress", variant: "warning" as const };
  const early = stored === "COMPLETED" && derivePeriodStatus(start, end) !== "COMPLETED";
  return { text: early ? "Closed early" : "Ended", variant: "success" as const };
}

export default async function AdminPayrollPage() {
  const rawCalendar = await db.payrollCalendar
    .findMany({ orderBy: { payDate: "desc" } })
    .catch(() => []);

  const calendar = rawCalendar.map((p) => ({
    ...p,
    displayStatus: effectivePeriodStatus(p.status, p.payPeriodStart, p.payPeriodEnd),
  }));
  const upcoming = calendar.filter((p) => p.displayStatus === "UPCOMING").length;
  const current = calendar.filter((p) => p.displayStatus === "CURRENT").length;
  const completed = calendar.filter((p) => p.displayStatus === "COMPLETED").length;

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
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Not started" value={upcoming} />
        <StatCard label="In progress" value={current} />
        <StatCard label="Ended" value={completed} />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">Pay periods ({calendar.length})</CardTitle>
            <CardDescription>
              Used for hours exports. Ended means the last day of the period has passed. Add one
              by hand only if you need a period before its pay stubs exist.
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
              const label = periodLabel(p.displayStatus, p.status, p.payPeriodStart, p.payPeriodEnd);
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
                    <Badge variant={label.variant} className="text-[10px]">{label.text}</Badge>
                    <span className="text-[10px] text-muted-foreground">View hours →</span>
                  </Link>
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
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
