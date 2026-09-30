import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Banknote } from "lucide-react";
import { CreatePayrollPeriodDialog } from "./create-period-dialog";
import { UploadPaystubsDialog } from "./upload-paystubs-dialog";
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

  const [docs, docCount, rawCalendar, employees] = await Promise.all([
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
    safe(
      db.employee.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
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
          <div className="flex gap-2">
            <UploadPaystubsDialog calendarPeriods={calendar} employees={employees} />
            <CreatePayrollPeriodDialog />
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Documents" value={docCount} icon={<Banknote className="h-4 w-4" />} />
        <StatCard label="Upcoming periods" value={upcoming} />
        <StatCard label="Current period" value={current} />
        <StatCard label="Completed periods" value={completed} />
      </div>

      <Tabs defaultValue="calendar" className="mt-6 space-y-4">
        <TabsList>
          <TabsTrigger value="calendar">Pay calendar ({calendar.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents ({docCount})</TabsTrigger>
        </TabsList>

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
                    <li key={p.id} className="flex items-center gap-2 pr-3 transition-colors hover:bg-muted/50">
                      <Link
                        href={`/admin/payroll/${p.id}`}
                        className="grid flex-1 grid-cols-[1fr_auto_auto_auto] items-center gap-3 p-3"
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
                  <li key={d.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 p-3">
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
                    <PayrollDocumentActions id={d.id} title={d.title} />
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
