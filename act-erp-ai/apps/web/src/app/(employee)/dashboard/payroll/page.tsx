import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Banknote, Download, Eye } from "lucide-react";
import { businessDateOnly } from "@/lib/format";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("records.payroll.title") };
}

export default async function EmployeePayrollPage() {
  const {
    t,
    formatDateOnly: formatLocalizedDate,
    formatDateTime,
  } = await getPortalLanguage();
  const user = await requireUser();
  if (!user.employeeId)
    return <p className="text-sm text-muted-foreground">{t("records.noEmployee")}</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
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
      <PageHeader
        title={t("records.payroll.title")}
        description={t("records.payroll.description")}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t("records.payroll.documents")}
          value={docs.length}
          icon={<Banknote className="h-4 w-4" />}
        />
        <StatCard
          label={t("records.payroll.lastPeriod")}
          value={lastEnd ? formatLocalizedDate(lastEnd) : "—"}
        />
        <StatCard
          label={t("records.payroll.nextPayDate")}
          value={calendar[0] ? formatLocalizedDate(calendar[0].payDate) : "—"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("records.payroll.myDocuments")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {docs.length === 0 && (
                <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                  {t("records.payroll.empty")}
                </li>
              )}
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{d.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.category} · {formatLocalizedDate(d.payPeriodStart)} →{" "}
                      {formatLocalizedDate(d.payPeriodEnd)}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDateTime(d.uploadedAt)}
                  </span>
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/api/payroll/${d.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      aria-label={t("records.payroll.viewDocument", { title: d.title })}
                    >
                      <Eye className="inline h-3 w-3" />
                    </Link>
                    <a
                      href={`/api/payroll/${d.id}/file?download=1`}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      aria-label={t("records.payroll.downloadDocument", {
                        title: d.title,
                      })}
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
          <CardHeader>
            <CardTitle className="text-base">
              {t("records.payroll.upcomingPayDates")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {calendar.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t("records.payroll.noneScheduled")}
              </p>
            )}
            {calendar.map((p) => (
              <div key={p.id} className="rounded-md border p-3">
                <p className="font-medium">{p.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {t("records.payroll.period")}: {formatLocalizedDate(p.payPeriodStart)} →{" "}
                  {formatLocalizedDate(p.payPeriodEnd)}
                </p>
                <p className="mt-1 text-xs">
                  {t("records.payroll.payDate")}:{" "}
                  <span className="font-mono tabular-nums">
                    {formatLocalizedDate(p.payDate)}
                  </span>
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
