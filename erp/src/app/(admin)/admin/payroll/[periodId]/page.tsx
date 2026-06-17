import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, StatCard } from "@/components/page-header";
import { getPayrollSlipsForPeriod } from "@/server/queries/payroll-slip";
import { DownloadCsvButton } from "./download-csv-button";
import { PrintClient } from "./print-button";

export const metadata = { title: "Payroll period" };

export default async function PayrollPeriodPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const { periodId } = await params;
  const period = await db.payrollCalendar
    .findUnique({ where: { id: periodId } })
    .catch(() => null);
  if (!period) notFound();

  const slips = await getPayrollSlipsForPeriod(period.payPeriodStart, period.payPeriodEnd);
  const totalEmployees = slips.length;
  const totalHours = slips.reduce((s, r) => s + r.totalHours, 0);
  const totalOT = slips.reduce((s, r) => s + r.overtimeHours, 0);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4 print:hidden">
        <Link href="/admin/payroll">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Pay calendar
        </Link>
      </Button>

      <PageHeader
        title={period.title}
        description={`${period.payPeriodStart.toLocaleDateString()} → ${period.payPeriodEnd.toLocaleDateString()} · pay date ${period.payDate.toLocaleDateString()}`}
        actions={
          <div className="flex gap-2 print:hidden">
            <DownloadCsvButton periodId={period.id} title={period.title} />
            <PrintButton />
          </div>
        }
      />

      <div className="mb-6 flex items-center gap-2 print:hidden">
        <Badge variant={period.status === "COMPLETED" ? "success" : period.status === "CURRENT" ? "warning" : "outline"}>
          {period.status}
        </Badge>
        {period.notes && (
          <span className="text-xs text-muted-foreground">{period.notes}</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 print:hidden">
        <StatCard label="Employees" value={totalEmployees} />
        <StatCard label="Total hours" value={totalHours.toFixed(1)} />
        <StatCard label="Overtime hours" value={totalOT.toFixed(1)} />
      </div>

      {/* Print header */}
      <div className="hidden print:block mb-4">
        <h1 className="text-2xl font-bold">ACT — Payroll Slip</h1>
        <p className="text-sm text-muted-foreground">{period.title}</p>
        <p className="text-xs text-muted-foreground">
          Period: {period.payPeriodStart.toLocaleDateString()} → {period.payPeriodEnd.toLocaleDateString()} ·
          Pay date: {period.payDate.toLocaleDateString()} ·
          Generated {new Date().toLocaleString()}
        </p>
      </div>

      <Card className="mt-6 print:border-0 print:shadow-none">
        <CardHeader className="print:hidden">
          <CardTitle className="text-base">Payroll slip · {totalEmployees} employees</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Regular</TableHead>
                <TableHead className="text-right">Overtime</TableHead>
                <TableHead className="text-right">Total hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slips.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                    No approved time entries in this period.
                  </TableCell>
                </TableRow>
              )}
              {slips.map((r) => (
                <TableRow key={r.employeeRowId}>
                  <TableCell className="font-mono text-xs">{r.employeeId}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.department ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{r.daysWorked}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {r.regularHours.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {r.overtimeHours > 0 ? (
                      <span className="text-primary">{r.overtimeHours.toFixed(2)}</span>
                    ) : (
                      <span className="text-muted-foreground">0.00</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                    {r.totalHours.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
              {slips.length > 0 && (
                <TableRow className="bg-muted/30 font-semibold">
                  <TableCell colSpan={3} className="text-right text-xs uppercase tracking-wider text-muted-foreground">
                    Totals
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {slips.reduce((s, r) => s + r.daysWorked, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {slips.reduce((s, r) => s + r.regularHours, 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {totalOT.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {totalHours.toFixed(2)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="mt-4 text-[10px] text-muted-foreground print:mt-8">
        Hours computed from approved time entries within the pay period. Overtime
        = hours over 40 in any ISO week (US standard). Pay rates are deliberately
        omitted on this slip — finance computes gross pay from these hours.
      </p>
    </>
  );
}

function PrintButton() {
  return <PrintClient />;
}
