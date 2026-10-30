import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { HoursSubnav } from "@/components/hours-subnav";
import { resolveHoursRange, loadHoursPeriodPresets } from "@/lib/hours-period";
import { DEFAULT_EXPORT_COLUMNS } from "@/lib/hours-export";
import { PeriodExportClient } from "./period-export-client";

export const metadata = { title: "Period export" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PeriodExportPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const { fromStr, toStr } = resolveHoursRange(one(sp.from), one(sp.to));
  const periodId = one(sp.period).trim();

  const [presets, templates, schedules, departments, period] = await Promise.all([
    loadHoursPeriodPresets(),
    db.hoursExportTemplate.findMany({ orderBy: { name: "asc" } }).catch(() => []),
    db.hoursExportSchedule
      .findMany({
        orderBy: { createdAt: "desc" },
        include: { template: { select: { name: true } } },
      })
      .catch(() => []),
    db.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    periodId
      ? db.payrollCalendar.findUnique({ where: { id: periodId } })
      : Promise.resolve(null),
  ]);

  const initialFrom = period
    ? period.payPeriodStart.toISOString().slice(0, 10)
    : fromStr;
  const initialTo = period ? period.payPeriodEnd.toISOString().slice(0, 10) : toStr;

  return (
    <>
      <PageHeader
        title="Period export"
        description="Configurable hours CSV for payroll. Save templates and weekly automation."
        actions={
          <ButtonLink href="/admin/payroll">Payroll periods</ButtonLink>
        }
      />
      <HoursSubnav />
      {period ? (
        <p className="mb-3 text-sm text-muted-foreground">
          Prefilling from payroll period <strong>{period.title}</strong>.{" "}
          <Link href="/admin/hours/period-export" className="underline">
            Clear
          </Link>
        </p>
      ) : null}
      <PeriodExportClient
        initialFrom={initialFrom}
        initialTo={initialTo}
        presets={presets}
        departments={departments}
        defaultColumns={[...DEFAULT_EXPORT_COLUMNS]}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          columns: t.columns,
          splitBy: t.splitBy,
          includeHeader: t.includeHeader,
          includeSalaried: t.includeSalaried,
          approvedOnly: t.approvedOnly,
          sortOrder: t.sortOrder,
          isDefault: t.isDefault,
        }))}
        schedules={schedules.map((s) => ({
          id: s.id,
          description: s.description,
          templateName: s.template.name,
          weekday: s.weekday,
          minuteOfDay: s.minuteOfDay,
          rangeDays: s.rangeDays,
          enabled: s.enabled,
          lastRunAt: s.lastRunAt?.toISOString() ?? null,
          lastError: s.lastError,
        }))}
      />
    </>
  );
}

function ButtonLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm hover:bg-accent"
    >
      {children}
    </Link>
  );
}
