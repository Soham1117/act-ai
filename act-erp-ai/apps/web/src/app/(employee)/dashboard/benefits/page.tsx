import Link from "next/link";
import {
  HeartPulse,
  Wallet,
  PiggyBank,
  ShieldAlert,
  ShieldCheck,
  Phone,
  ExternalLink,
  FileText,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader, StatCard, EmptyState } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateOnly } from "@/lib/format";
import {
  coverageState,
  resolveCost,
  tierLabel,
  costPeriodLabel,
  benefitTypeLabel,
  utcToday,
  type CoverageState,
} from "@/lib/benefits";
import type { BenefitEnrollmentStatus, BenefitType, CoverageTier } from "@prisma/client";

export const metadata = { title: "Benefits" };

const HEALTH_TYPE_ORDER: BenefitType[] = ["MEDICAL", "DENTAL", "VISION"];
const CONFIRMED_STALE_DAYS = 90;

type DatedRow = { status: BenefitEnrollmentStatus; effectiveDate: Date; endDate: Date | null };

/** Picks the one row per group the page treats as "the current line": a
 * currently-in-force row if one exists, else the nearest future-dated
 * (pending) row, else the most recent row (covers waived/lapsed). Every
 * other row in the group is "past coverage." Rows for one type never
 * overlap in date range (enforced on write), so this is unambiguous. */
function pickPrimary<T extends DatedRow & { plan: { planYearEnd: Date | null } }>(
  rows: T[],
  today: Date,
): { primary: T | null; rest: T[]; state: CoverageState } {
  let current: T | null = null;
  let pending: T | null = null;
  let mostRecent: T | null = null;
  for (const r of rows) {
    const s = coverageState(r, r.plan.planYearEnd, today);
    if (s === "current" && (!current || r.effectiveDate > current.effectiveDate)) current = r;
    if (s === "pending" && (!pending || r.effectiveDate < pending.effectiveDate)) pending = r;
    if (!mostRecent || r.effectiveDate > mostRecent.effectiveDate) mostRecent = r;
  }
  const primary = current ?? pending ?? mostRecent;
  const rest = rows.filter((r) => r !== primary);
  const state = primary ? coverageState(primary, primary.plan.planYearEnd, today) : "none";
  return { primary, rest, state };
}

export default async function EmployeeBenefitsPage() {
  const user = await requireUser();
  if (!user.employeeId) return <p className="text-sm text-muted-foreground">No employee record.</p>;

  const today = utcToday();

  const [rawEnrollments, rawElections, docs, employee] = await Promise.all([
    db.benefitEnrollment.findMany({
      where: { employeeId: user.employeeId },
      include: { plan: { include: { tiers: true } } },
      orderBy: { effectiveDate: "desc" },
    }),
    db.retirementElection.findMany({
      where: { employeeId: user.employeeId },
      include: { plan: true },
      orderBy: { effectiveDate: "desc" },
    }),
    // BENEFITS documents are broadcast to all employees, same as COMPANY —
    // mirrors listMyDocuments' type-based OR branch, so no employeeId filter.
    db.document.findMany({
      where: { documentType: "BENEFITS" },
      orderBy: { uploadedAt: "desc" },
    }),
    db.employee.findUnique({
      where: { id: user.employeeId },
      select: { employmentStatus: true, terminationDate: true },
    }),
  ]);

  // Decimal fields can't cross into anything but plain markup — map to
  // number here, once, before any of this touches the page body below.
  const enrollments = rawEnrollments.map((e) => ({
    id: e.id,
    tier: e.tier,
    status: e.status,
    effectiveDate: e.effectiveDate,
    endDate: e.endDate,
    memberId: e.memberId,
    confirmedAsOf: e.confirmedAsOf,
    employeeCostOverride: e.employeeCostOverride === null ? null : Number(e.employeeCostOverride),
    employerCostOverride: e.employerCostOverride === null ? null : Number(e.employerCostOverride),
    plan: {
      id: e.plan.id,
      type: e.plan.type,
      name: e.plan.name,
      carrierName: e.plan.carrierName,
      carrierPhone: e.plan.carrierPhone,
      carrierPortalUrl: e.plan.carrierPortalUrl,
      groupNumber: e.plan.groupNumber,
      costPeriod: e.plan.costPeriod,
      planYearStart: e.plan.planYearStart,
      planYearEnd: e.plan.planYearEnd,
      tiers: e.plan.tiers.map((t) => ({
        tier: t.tier,
        employeeCost: Number(t.employeeCost),
        employerCost: Number(t.employerCost),
      })),
    },
  }));

  const elections = rawElections.map((el) => ({
    id: el.id,
    status: el.status,
    effectiveDate: el.effectiveDate,
    endDate: el.endDate,
    confirmedAsOf: el.confirmedAsOf,
    preTaxPercent: el.preTaxPercent === null ? null : Number(el.preTaxPercent),
    rothPercent: el.rothPercent === null ? null : Number(el.rothPercent),
    flatAmountPerPay: el.flatAmountPerPay === null ? null : Number(el.flatAmountPerPay),
    plan: {
      id: el.plan.id,
      name: el.plan.name,
      carrierName: el.plan.carrierName,
      carrierPortalUrl: el.plan.carrierPortalUrl,
      matchDescription: el.plan.matchDescription,
      vestingDescription: el.plan.vestingDescription,
      planYearEnd: el.plan.planYearEnd,
    },
  }));

  if (enrollments.length === 0 && elections.length === 0) {
    return (
      <>
        <PageHeader
          title="Benefits"
          description="A mirror of what we have on file with our carriers. Your carrier holds the official record."
        />
        <EmptyState
          icon={<HeartPulse className="h-6 w-6" />}
          title="No benefits information on file"
          description="We don't have benefits information on file for you yet. That doesn't necessarily mean you aren't covered — this page only shows what HR has entered. Contact HR to confirm your coverage."
        />
      </>
    );
  }

  const byType = new Map<BenefitType, typeof enrollments>();
  for (const e of enrollments) {
    const list = byType.get(e.plan.type) ?? [];
    list.push(e);
    byType.set(e.plan.type, list);
  }
  const orderedTypes = [
    ...HEALTH_TYPE_ORDER.filter((t) => byType.has(t)),
    ...[...byType.keys()].filter((t) => !HEALTH_TYPE_ORDER.includes(t)),
  ];

  const healthGroups = orderedTypes.map((type) => ({
    type,
    ...pickPrimary(byType.get(type)!, today),
  }));
  const retirementGroup = pickPrimary(elections, today);

  const pastEnrollments = healthGroups.flatMap((g) => g.rest);
  const pastElections = retirementGroup.rest;

  // Stat 1 — plans currently, actively enrolled (health coverage only;
  // 401(k) gets its own stat below).
  const plansEnrolledCount = healthGroups.filter(
    (g) => g.state === "current" && g.primary?.status === "ENROLLED",
  ).length;

  // Stat 2 — sum only same-period currency together. Mixing a monthly and a
  // per-paycheck figure into one bare number is exactly the bug this
  // feature exists to avoid (see costPeriodLabel).
  let perPaycheckSum = 0;
  const otherPeriodCosts: { label: string; amount: number; period: string }[] = [];
  for (const g of healthGroups) {
    if (g.state !== "current" || g.primary?.status !== "ENROLLED") continue;
    const cost = resolveCost(g.primary, g.primary.plan.tiers);
    if (!cost) continue;
    if (g.primary.plan.costPeriod === "PER_PAYCHECK") {
      perPaycheckSum += cost.employeeCost;
    } else {
      otherPeriodCosts.push({
        label: benefitTypeLabel(g.type),
        amount: cost.employeeCost,
        period: costPeriodLabel(g.primary.plan.costPeriod),
      });
    }
  }

  // Stat 3 — 401(k) deferral.
  const activeElection =
    retirementGroup.state === "current" && retirementGroup.primary?.status === "ENROLLED"
      ? retirementGroup.primary
      : null;
  let deferralLabel = "—";
  if (activeElection) {
    if (activeElection.flatAmountPerPay !== null) {
      deferralLabel = `${formatCurrency(activeElection.flatAmountPerPay)} per paycheck`;
    } else if (activeElection.preTaxPercent !== null || activeElection.rothPercent !== null) {
      const parts: string[] = [];
      if (activeElection.preTaxPercent !== null) parts.push(`${activeElection.preTaxPercent}% pre-tax`);
      if (activeElection.rothPercent !== null) parts.push(`${activeElection.rothPercent}% Roth`);
      deferralLabel = parts.join(" + ");
    }
  }

  // Stat 4 — freshness. The oldest confirmedAsOf among currently-active
  // rows is the honest number: it's only as fresh as the stalest thing
  // still in force.
  const activeConfirmDates = [
    ...healthGroups.filter((g) => g.state === "current").map((g) => g.primary!.confirmedAsOf),
    ...(retirementGroup.state === "current" ? [retirementGroup.primary!.confirmedAsOf] : []),
  ];
  const oldestConfirmed =
    activeConfirmDates.length > 0
      ? activeConfirmDates.reduce((a, b) => (a < b ? a : b))
      : null;
  const daysSinceConfirmed = oldestConfirmed
    ? Math.floor((today.getTime() - oldestConfirmed.getTime()) / 86_400_000)
    : null;
  const confirmedStale = daysSinceConfirmed !== null && daysSinceConfirmed > CONFIRMED_STALE_DAYS;

  return (
    <>
      <PageHeader
        title="Benefits"
        description="A mirror of what we have on file with our carriers. Your carrier holds the official record — not this page."
      />

      {employee?.employmentStatus === "TERMINATED" && (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 text-sm">
            <p className="font-medium">
              Your coverage ended {employee.terminationDate ? formatDateOnly(employee.terminationDate) : "on your last day"}.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Continuation coverage, if you&apos;re eligible, is handled directly by your carrier(s) — contact HR
              for details on how to continue coverage.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Plans enrolled" value={plansEnrolledCount} icon={<HeartPulse className="h-4 w-4" />} />
        <StatCard
          label="Your cost per paycheck"
          value={formatCurrency(perPaycheckSum)}
          icon={<Wallet className="h-4 w-4" />}
          delta={
            otherPeriodCosts.length > 0
              ? {
                  value:
                    "+ " +
                    otherPeriodCosts
                      .map((c) => `${formatCurrency(c.amount)} ${c.period} (${c.label})`)
                      .join(", "),
                }
              : undefined
          }
        />
        <StatCard label="401(k) deferral" value={deferralLabel} icon={<PiggyBank className="h-4 w-4" />} />
        <StatCard
          label="Confirmed as of"
          value={oldestConfirmed ? formatDateOnly(oldestConfirmed) : "—"}
          icon={
            confirmedStale ? (
              <ShieldAlert className="h-4 w-4 text-amber-500" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )
          }
          delta={
            confirmedStale
              ? { value: `${daysSinceConfirmed}d ago — ask HR to re-verify`, positive: false }
              : undefined
          }
        />
      </div>

      <div className="mt-6 space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Health coverage</h2>
        {healthGroups.length === 0 && (
          <p className="text-xs text-muted-foreground">No medical, dental, or vision information on file.</p>
        )}
        {healthGroups.map((g) => (
          <HealthCoverageCard key={g.type} type={g.type} state={g.state} row={g.primary!} />
        ))}
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Retirement</h2>
        {elections.length === 0 ? (
          <p className="text-xs text-muted-foreground">No 401(k) election on file.</p>
        ) : (
          <RetirementCard state={retirementGroup.state} row={retirementGroup.primary!} />
        )}
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan documents</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {docs.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">No benefits documents on file.</p>
            ) : (
              <ul className="divide-y">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{d.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {d.uploadedAt.toLocaleDateString()}
                      </p>
                    </div>
                    <a
                      href={`/api/documents/${d.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border px-2 py-1 text-primary hover:bg-muted"
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {(pastEnrollments.length > 0 || pastElections.length > 0) && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Past coverage</h2>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {pastEnrollments.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">{benefitTypeLabel(e.plan.type)}</span>
                      {" · "}
                      {e.plan.name} · {tierLabel(e.tier)}
                    </div>
                    <span className="text-xs">
                      {formatDateOnly(e.effectiveDate)} → {e.endDate ? formatDateOnly(e.endDate) : "present"}
                    </span>
                  </li>
                ))}
                {pastElections.map((el) => (
                  <li key={el.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">401(k)</span> · {el.plan.name}
                    </div>
                    <span className="text-xs">
                      {formatDateOnly(el.effectiveDate)} → {el.endDate ? formatDateOnly(el.endDate) : "present"}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

type HealthRow = {
  id: string;
  tier: CoverageTier | null;
  status: BenefitEnrollmentStatus;
  effectiveDate: Date;
  endDate: Date | null;
  memberId: string | null;
  confirmedAsOf: Date;
  employeeCostOverride: number | null;
  employerCostOverride: number | null;
  plan: {
    id: string;
    type: BenefitType;
    name: string;
    carrierName: string;
    carrierPhone: string | null;
    carrierPortalUrl: string | null;
    groupNumber: string | null;
    costPeriod: "PER_PAYCHECK" | "MONTHLY" | "ANNUAL";
    planYearStart: Date;
    planYearEnd: Date;
    tiers: { tier: CoverageTier; employeeCost: number; employerCost: number }[];
  };
};

function HealthCoverageCard({
  type,
  state,
  row,
}: {
  type: BenefitType;
  state: CoverageState;
  row: HealthRow;
}) {
  const year = row.plan.planYearStart.getUTCFullYear();

  if (state === "waived") {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div>
            <Badge variant="outline" className="mb-1 text-[10px]">{benefitTypeLabel(type)}</Badge>
            <p className="text-sm text-muted-foreground">
              You declined {row.plan.name} coverage for the {year} plan year, effective{" "}
              {formatDateOnly(row.effectiveDate)}.
            </p>
          </div>
          <CardFooterLink />
        </CardContent>
      </Card>
    );
  }

  if (state === "lapsed") {
    // Two distinct reasons a row can be "lapsed," and the copy has to say
    // which: an explicit end date (someone ended this coverage on purpose)
    // vs. the plan year simply running out with no renewal entered yet —
    // never render either as if it were still current.
    const explicitlyEnded = !!row.endDate && row.endDate <= utcToday();
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="text-base">
            {explicitlyEnded
              ? `${row.plan.name} — coverage ended`
              : `Your ${year} ${benefitTypeLabel(type)} coverage (this plan year has ended)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {explicitlyEnded ? (
            <>Coverage ended {formatDateOnly(row.endDate!)}. Contact HR with questions.</>
          ) : (
            <>Renewal information hasn&apos;t been entered yet; your coverage may have continued. Contact HR.</>
          )}
        </CardContent>
        <div className="border-t px-4 py-2">
          <CardFooterLink />
        </div>
      </Card>
    );
  }

  const cost = resolveCost(row, row.plan.tiers);
  const isPending = state === "pending";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <Badge variant="outline" className="mb-1 text-[10px]">{benefitTypeLabel(type)}</Badge>
          <CardTitle className="text-base">{row.plan.name}</CardTitle>
          <p className="text-xs text-muted-foreground">{row.plan.carrierName}</p>
        </div>
        {isPending && (
          <Badge variant="warning" className="text-[10px]">
            Starts {formatDateOnly(row.effectiveDate)}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Tier" value={tierLabel(row.tier)} />
          <Field label="Member ID" value={row.memberId ?? "—"} mono />
          <Field label="Group number" value={row.plan.groupNumber ?? "—"} mono />
          <Field label="Effective" value={formatDateOnly(row.effectiveDate)} />
          <Field
            label="Your cost"
            value={cost ? `${formatCurrency(cost.employeeCost)} ${costPeriodLabel(row.plan.costPeriod)}` : "—"}
          />
          <Field
            label="Employer cost"
            value={cost ? `${formatCurrency(cost.employerCost)} ${costPeriodLabel(row.plan.costPeriod)}` : "—"}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-xs">
          {row.plan.carrierPhone && (
            <a href={`tel:${row.plan.carrierPhone}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Phone className="h-3 w-3" /> {row.plan.carrierPhone}
            </a>
          )}
          {row.plan.carrierPortalUrl && (
            <a
              href={row.plan.carrierPortalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Carrier portal
            </a>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Confirmed with {row.plan.carrierName} on {formatDateOnly(row.confirmedAsOf)}.
        </p>
      </CardContent>
      <div className="border-t px-4 py-2">
        <CardFooterLink />
      </div>
    </Card>
  );
}

type RetirementRow = {
  id: string;
  status: BenefitEnrollmentStatus;
  effectiveDate: Date;
  endDate: Date | null;
  confirmedAsOf: Date;
  preTaxPercent: number | null;
  rothPercent: number | null;
  flatAmountPerPay: number | null;
  plan: {
    id: string;
    name: string;
    carrierName: string;
    carrierPortalUrl: string | null;
    matchDescription: string | null;
    vestingDescription: string | null;
    planYearEnd: Date;
  };
};

function RetirementCard({ state, row }: { state: CoverageState; row: RetirementRow }) {
  if (state === "waived") {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          You declined 401(k) participation in {row.plan.name}, effective {formatDateOnly(row.effectiveDate)}.
        </CardContent>
        <div className="border-t px-4 py-2">
          <CardFooterLink />
        </div>
      </Card>
    );
  }

  if (state === "lapsed") {
    // Same reasoning as HealthCoverageCard: a 401(k) plan also has a plan
    // year and can be rolled forward, so it can lapse the same way — never
    // render a stale election as if it were still current.
    const explicitlyEnded = !!row.endDate && row.endDate <= utcToday();
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="text-base">
            {explicitlyEnded ? `${row.plan.name} — election ended` : `${row.plan.name} (this plan year has ended)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {explicitlyEnded ? (
            <>Deferral stopped {formatDateOnly(row.endDate!)}. Contact HR with questions.</>
          ) : (
            <>Renewal information hasn&apos;t been entered yet; your deferral may have continued. Contact HR.</>
          )}
        </CardContent>
        <div className="border-t px-4 py-2">
          <CardFooterLink />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{row.plan.name}</CardTitle>
        <p className="text-xs text-muted-foreground">{row.plan.carrierName}</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Pre-tax deferral" value={row.preTaxPercent !== null ? `${row.preTaxPercent}%` : "—"} />
          <Field label="Roth deferral" value={row.rothPercent !== null ? `${row.rothPercent}%` : "—"} />
          {row.flatAmountPerPay !== null && (
            <Field label="Flat amount" value={`${formatCurrency(row.flatAmountPerPay)} per paycheck`} />
          )}
          <Field label="Effective" value={formatDateOnly(row.effectiveDate)} />
        </div>
        {row.plan.matchDescription && (
          <p className="rounded-md border bg-muted/40 p-3 text-xs">
            <span className="font-medium">Employer match: </span>
            {row.plan.matchDescription}
          </p>
        )}
        {row.plan.vestingDescription && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Vesting: </span>
            {row.plan.vestingDescription}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Your balance, investments, and beneficiaries live with {row.plan.carrierName} — sign in there.
        </p>
        <div className="flex items-center gap-3 border-t pt-3 text-xs">
          {row.plan.carrierPortalUrl && (
            <a
              href={row.plan.carrierPortalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Carrier portal
            </a>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Confirmed with {row.plan.carrierName} on {formatDateOnly(row.confirmedAsOf)}.
        </p>
      </CardContent>
      <div className="border-t px-4 py-2">
        <CardFooterLink />
      </div>
    </Card>
  );
}

function CardFooterLink() {
  return (
    <Link href="/dashboard/requests?type=BENEFITS_INQUIRY" className="text-[11px] text-primary hover:underline">
      Something look wrong?
    </Link>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono text-sm" : "text-sm"}>{value}</p>
    </div>
  );
}
