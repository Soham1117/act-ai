import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { MobileTabsList } from "@/components/mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Banknote, Upload } from "lucide-react";
import { CreatePayrollPeriodForm } from "./create-period-form";
import { PeriodActions } from "./period-actions";
import { PayrollDocumentActions } from "./document-actions";
import { effectivePeriodStatus } from "@/lib/payroll-period";
import { formatDateOnly } from "@/lib/format";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export const metadata = { title: "Payroll" };

export default async function AdminPayrollPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [docs, docCount, rawCalendar] = await Promise.all([
    safe(
      db.payroll.findMany({
        orderBy: { uploadedAt: "desc" },
        take: 100,
        include: { employee: { select: { name: true } } },
      }),
      [],
    ),
    safe(db.payroll.count(), 0),
    safe(
      db.payrollCalendar.findMany({ orderBy: { payDate: "desc" } }),
      [],
    ),
  ]);

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
        description="Manage pay periods and upload pay stubs."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/payroll/import">
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Upload pay stubs
              </Link>
            </Button>
          </div>
        }
      />
      <div className="mb-6"><CreatePayrollPeriodForm /></div>
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Documents" value={docCount} icon={<Banknote className="h-4 w-4" />} />
        <StatCard label="Upcoming periods" value={upcoming} />
        <StatCard label="Current period" value={current} />
        <StatCard label="Completed periods" value={completed} />
      </div>

      <Tabs defaultValue="calendar" className="mt-6 space-y-4">
        <MobileTabsList>
          <TabsTrigger value="calendar">Pay calendar ({calendar.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents ({docCount})</TabsTrigger>
        </MobileTabsList>

        <TabsContent value="calendar">
          <Card>
            <CardHeader><CardTitle className="text-base">Pay periods</CardTitle></CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {calendar.length === 0 && (
                  <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                    No pay periods configured. Create one with the button above.
                  </li>
                )}
                {calendar.map((p) => {
                  const variant =
                    p.displayStatus === "CURRENT" ? "warning" :
                    p.displayStatus === "COMPLETED" ? "success" : "outline";
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
                        <span className="font-mono text-xs">
                          Pay {formatDateOnly(p.payDate)}
                        </span>
                        <Badge variant={variant} className="text-[10px]">{p.displayStatus}</Badge>
                        <span className="text-[10px] text-muted-foreground">
                          Open slip →
                        </span>
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
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent uploads{docCount > docs.length ? ` (latest ${docs.length} of ${docCount})` : ""}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {docs.length === 0 && (
                  <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                    No payroll documents uploaded yet.
                  </li>
                )}
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-col gap-2 p-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-3">
                    <div>
                      <p className="text-sm font-medium">{d.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {d.employee.name} · {d.category}
                      </p>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {formatDateOnly(d.payPeriodStart)} → {formatDateOnly(d.payPeriodEnd)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {d.uploadedAt.toLocaleDateString()}
                    </span>
                    <div className="min-w-0 sm:col-span-full"><PayrollDocumentActions id={d.id} title={d.title} /></div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
