import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Banknote, Download, Eye } from "lucide-react";
import { businessDateOnly, formatDateOnly } from "@/lib/format";

export const metadata = { title: "Payroll" };

export default async function EmployeePayrollPage() {
  const user = await requireUser();
  if (!user.employeeId) return <p className="text-sm text-muted-foreground">No employee record.</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [docs, calendar] = await Promise.all([
    safe(
      db.payroll.findMany({
        where: { employeeId: user.employeeId },
        orderBy: { payPeriodEnd: "desc" },
        take: 50,
      }),
      [],
    ),
    safe(
      db.payrollCalendar.findMany({
        // Pay dates are calendar days: today's pay date still counts as upcoming.
        where: { payDate: { gte: businessDateOnly() } },
        orderBy: { payDate: "asc" },
        take: 5,
      }),
      [],
    ),
  ]);

  const lastEnd = docs[0]?.payPeriodEnd;

  return (
    <>
      <PageHeader title="Payroll" description="Pay stubs, tax docs, and pay periods." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Documents" value={docs.length} icon={<Banknote className="h-4 w-4" />} />
        <StatCard label="Last pay period" value={lastEnd ? formatDateOnly(lastEnd) : "—"} />
        <StatCard label="Next pay date" value={calendar[0] ? formatDateOnly(calendar[0].payDate) : "—"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">My documents</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {docs.length === 0 && (
                <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                  No payroll documents yet.
                </li>
              )}
              {docs.map((d) => (
                <li key={d.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 p-3">
                  <div>
                    <p className="text-sm font-medium">{d.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.category} · {formatDateOnly(d.payPeriodStart)} → {formatDateOnly(d.payPeriodEnd)}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {d.uploadedAt.toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/api/payroll/${d.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      aria-label={`View ${d.title}`}
                    >
                      <Eye className="inline h-3 w-3" />
                    </Link>
                    <a
                      href={`/api/payroll/${d.id}/file?download=1`}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      aria-label={`Download ${d.title}`}
                    >
                      <Download className="inline h-3 w-3" />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Upcoming pay dates</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {calendar.length === 0 && (
              <p className="text-xs text-muted-foreground">None scheduled.</p>
            )}
            {calendar.map((p) => (
              <div key={p.id} className="rounded-md border p-3">
                <p className="font-medium">{p.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  Period: {formatDateOnly(p.payPeriodStart)} → {formatDateOnly(p.payPeriodEnd)}
                </p>
                <p className="mt-1 text-xs">
                  Pay date:{" "}
                  <span className="font-mono tabular-nums">{formatDateOnly(p.payDate)}</span>
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
