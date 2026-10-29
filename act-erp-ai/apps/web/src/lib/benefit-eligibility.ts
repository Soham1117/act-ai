/** Proposed dates only. These helpers never create coverage or payroll rows. */
export const ELIGIBILITY_TYPES = [
  "MEDICAL",
  "DENTAL",
  "VISION",
  "RETIREMENT_401K",
] as const;
export type EligibilityType = (typeof ELIGIBILITY_TYPES)[number];
export type EligibilityRule = "INSURANCE_60_DAYS" | "RETIREMENT_ONE_YEAR";
export type EligibilityClassification = "ELIGIBLE" | "INELIGIBLE" | "REVIEW_REQUIRED";

export const eligibilityRuleFor = (type: string): EligibilityRule =>
  type === "RETIREMENT_401K" ? "RETIREMENT_ONE_YEAR" : "INSURANCE_60_DAYS";

export function eligibilityDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const key =
    value instanceof Date
      ? Number.isNaN(value.getTime())
        ? ""
        : value.toISOString().slice(0, 10)
      : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === key
    ? date
    : null;
}

export type EligibilityPolicy = {
  id: string;
  benefitType: string;
  rule: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  confirmed: boolean;
};
export type EligibilityAssessment = {
  classification: string;
  serviceDate: Date | null;
  confirmedAt: Date | null;
};
export type EligibilityResult = {
  state: "REVIEW_REQUIRED" | "NOT_ELIGIBLE" | "NOT_YET_ELIGIBLE" | "ELIGIBLE_TO_APPLY";
  proposedDate: string | null;
  reason: string;
};

export function proposedEligibilityDate(
  rule: string,
  serviceDate: Date,
): { date: Date | null; review: string | null } {
  const start = eligibilityDate(serviceDate);
  if (!start) return { date: null, review: "A valid service date is needed." };
  if (rule === "INSURANCE_60_DAYS") {
    const milestone = new Date(start);
    milestone.setUTCDate(milestone.getUTCDate() + 60);
    const date = new Date(
      Date.UTC(milestone.getUTCFullYear(), milestone.getUTCMonth() + 1, 1),
    );
    return {
      date,
      review:
        milestone.getUTCDate() === 1
          ? "HR must review a 60-day milestone on the first of a month."
          : null,
    };
  }
  if (rule === "RETIREMENT_ONE_YEAR") {
    if (start.getUTCMonth() === 1 && start.getUTCDate() === 29) {
      return {
        date: null,
        review: "HR must confirm the service anniversary for a February 29 start.",
      };
    }
    const year = start.getUTCFullYear() + 1;
    const milestone = new Date(Date.UTC(year, start.getUTCMonth(), start.getUTCDate()));
    const date = [
      new Date(Date.UTC(year, 3, 1)),
      new Date(Date.UTC(year, 9, 1)),
      new Date(Date.UTC(year + 1, 3, 1)),
    ].find((entry) => entry >= milestone)!;
    return {
      date,
      review:
        milestone.getUTCDate() === 1 && [3, 9].includes(milestone.getUTCMonth())
          ? "HR must review a service anniversary on an April 1 or October 1 entry date."
          : null,
    };
  }
  return { date: null, review: "This eligibility rule needs HR review." };
}

export function effectiveEligibilityPolicy(
  policies: EligibilityPolicy[],
  type: string,
  today: Date,
): EligibilityPolicy | null {
  const matches = policies.filter(
    (p) =>
      p.benefitType === type &&
      p.effectiveFrom <= today &&
      (!p.effectiveTo || today < p.effectiveTo),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function assessBenefitEligibility(args: {
  benefitType: string;
  hireDate: Date | null;
  employmentStatus: string;
  policy: EligibilityPolicy | null;
  assessment: EligibilityAssessment | null;
  today: Date;
}): EligibilityResult {
  const { benefitType, employmentStatus, policy, assessment } = args;
  const review = (
    reason: string,
    proposedDate: string | null = null,
  ): EligibilityResult => ({ state: "REVIEW_REQUIRED", proposedDate, reason });
  if (["TERMINATED", "INACTIVE"].includes(employmentStatus)) {
    return {
      state: "NOT_ELIGIBLE",
      proposedDate: null,
      reason: "HR must review eligibility before a return to service.",
    };
  }
  if (assessment?.classification === "INELIGIBLE") {
    return {
      state: "NOT_ELIGIBLE",
      proposedDate: null,
      reason: "HR has marked this employee outside the eligible group.",
    };
  }
  const start = assessment?.serviceDate ?? args.hireDate;
  const proposal = start
    ? proposedEligibilityDate(eligibilityRuleFor(benefitType), start)
    : null;
  const proposedDate = proposal?.date?.toISOString().slice(0, 10) ?? null;
  if (!policy || !policy.confirmed)
    return review("HR must confirm the applicable policy.", proposedDate);
  if (policy.rule !== eligibilityRuleFor(benefitType))
    return review("The policy does not match this benefit type.");
  if (!assessment?.confirmedAt || assessment.classification !== "ELIGIBLE")
    return review(
      "HR must confirm employee classification and service credit.",
      proposedDate,
    );
  if (!["ACTIVE", "ON_LEAVE"].includes(employmentStatus))
    return review("HR must review the employee's status.", proposedDate);
  if (!start || !proposal?.date)
    return review(proposal?.review ?? "A valid hire or service date is needed.");
  if (proposal.review) return review(proposal.review, proposedDate);
  const eligible = proposal.date <= args.today;
  return {
    state: eligible ? "ELIGIBLE_TO_APPLY" : "NOT_YET_ELIGIBLE",
    proposedDate,
    reason: eligible
      ? "Eligible to apply; HR or the provider must confirm enrollment."
      : "Proposed date; this is not an enrollment or coverage confirmation.",
  };
}

export const eligibilityStateLabel: Record<EligibilityResult["state"], string> = {
  REVIEW_REQUIRED: "Eligibility needs review",
  NOT_ELIGIBLE: "Not eligible",
  NOT_YET_ELIGIBLE: "Not yet eligible",
  ELIGIBLE_TO_APPLY: "Eligible to apply",
};
