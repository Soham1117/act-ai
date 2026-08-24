import type { BenefitCostPeriod, BenefitEnrollmentStatus, CoverageTier } from "@prisma/client";

/**
 * Pure, DB-free benefits logic — no stored ACTIVE/ENDED flag exists on
 * BenefitEnrollment or RetirementElection by design (see schema.prisma).
 * Whether coverage is current is always derived here, from dates, at read
 * time. A stored flag goes stale the day after it's written and would tell
 * a March termination they're still covered.
 */

export type CoverageState = "none" | "waived" | "pending" | "current" | "lapsed";

type DatedStatus = {
  status: BenefitEnrollmentStatus;
  effectiveDate: Date;
  endDate: Date | null;
};

/**
 * UTC-midnight "today." Postgres `@db.Date` values come back as a JS `Date`
 * at UTC midnight, so comparing them against `new Date()` (local now) can
 * put "today" on the wrong side of a boundary date depending on the
 * server's timezone. Build both sides of every date comparison in this file
 * from this function, never from a bare `new Date()`.
 */
export function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** True if `row` covers `today` — effective on or before today, and not yet
 * ended (endDate is an exclusive boundary: coverage ends ON that date). */
export function isCurrentCoverage(row: DatedStatus, today: Date = utcToday()): boolean {
  if (row.effectiveDate > today) return false;
  if (row.endDate && row.endDate <= today) return false;
  return true;
}

/**
 * Classifies one row (an enrollment, a retirement election, or `null` when
 * there's no row for this benefit type at all) into the state the UI
 * renders. `planYearEnd` is optional because RetirementElection isn't
 * scoped to tiers the same way, but medical/dental/vision plans use it to
 * distinguish "still current" from "the plan year ended and nobody has
 * entered a renewal yet" — never render last year's numbers as current.
 */
export function coverageState(
  row: DatedStatus | null,
  planYearEnd: Date | null = null,
  today: Date = utcToday(),
): CoverageState {
  if (!row) return "none";
  if (row.status === "WAIVED") return "waived";
  if (row.effectiveDate > today) return "pending";
  if (row.endDate && row.endDate <= today) return "lapsed";
  if (planYearEnd && planYearEnd < today) return "lapsed";
  return "current";
}

export type ResolvedCost = { employeeCost: number; employerCost: number };

type CostOverridable = {
  tier: CoverageTier | null;
  employeeCostOverride: number | null;
  employerCostOverride: number | null;
};

type TierPrice = { tier: CoverageTier; employeeCost: number; employerCost: number };

/**
 * Resolves what an enrollment actually costs: the override if one is set
 * (a deliberate, negotiated exception), otherwise the plan's standard rate
 * for that tier. Returns null when there's nothing to resolve — waived
 * (no tier) or a tier with no matching price row (a data-entry gap that
 * should surface as "—", not a wrong number).
 */
export function resolveCost(row: CostOverridable, tiers: TierPrice[]): ResolvedCost | null {
  if (!row.tier) return null;
  const standard = tiers.find((t) => t.tier === row.tier);
  const employeeCost = row.employeeCostOverride ?? standard?.employeeCost;
  const employerCost = row.employerCostOverride ?? standard?.employerCost;
  if (employeeCost === undefined || employerCost === undefined) return null;
  return { employeeCost, employerCost };
}

const TIER_LABELS: Record<CoverageTier, string> = {
  EMPLOYEE_ONLY: "Employee only",
  EMPLOYEE_SPOUSE: "Employee + spouse",
  EMPLOYEE_CHILDREN: "Employee + children",
  EMPLOYEE_PLUS_ONE: "Employee + 1",
  FAMILY: "Family",
  OTHER: "Other",
};

export function tierLabel(tier: CoverageTier | null | undefined): string {
  if (!tier) return "—";
  return TIER_LABELS[tier] ?? tier;
}

const PERIOD_LABELS: Record<BenefitCostPeriod, string> = {
  PER_PAYCHECK: "per paycheck",
  MONTHLY: "per month",
  ANNUAL: "per year",
};

/** Every currency figure in this feature must carry its period — a bare
 * "$212.40" with no period is how a monthly rate gets misread as what
 * actually leaves a paycheck. */
export function costPeriodLabel(period: BenefitCostPeriod): string {
  return PERIOD_LABELS[period] ?? period;
}

const BENEFIT_TYPE_LABELS: Record<string, string> = {
  MEDICAL: "Medical",
  DENTAL: "Dental",
  VISION: "Vision",
  RETIREMENT_401K: "401(k)",
  LIFE: "Life",
  DISABILITY_STD: "Short-term disability",
  DISABILITY_LTD: "Long-term disability",
  HSA: "HSA",
  FSA: "FSA",
  OTHER: "Other",
};

export function benefitTypeLabel(type: string): string {
  return BENEFIT_TYPE_LABELS[type] ?? type;
}
