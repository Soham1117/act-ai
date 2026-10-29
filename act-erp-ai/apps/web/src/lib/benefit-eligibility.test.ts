import { describe, expect, it } from "vitest";
import {
  assessBenefitEligibility,
  effectiveEligibilityPolicy,
  eligibilityDate,
  proposedEligibilityDate,
  type EligibilityPolicy,
} from "./benefit-eligibility";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const policy: EligibilityPolicy = {
  id: "p",
  benefitType: "MEDICAL",
  rule: "INSURANCE_60_DAYS",
  effectiveFrom: d("2026-01-01"),
  effectiveTo: null,
  confirmed: true,
};
const base = {
  benefitType: "MEDICAL",
  hireDate: d("2026-10-28"),
  employmentStatus: "ACTIVE",
  policy,
  assessment: {
    classification: "ELIGIBLE",
    serviceDate: d("2026-10-28"),
    confirmedAt: d("2026-10-28"),
  },
  today: d("2026-10-28"),
};

describe("benefit eligibility proposals", () => {
  it("matches HR's medical example without timestamp-zone arithmetic", () => {
    expect(assessBenefitEligibility(base)).toMatchObject({
      state: "NOT_YET_ELIGIBLE",
      proposedDate: "2027-01-01",
    });
    expect(assessBenefitEligibility({ ...base, today: d("2027-01-01") }).state).toBe(
      "ELIGIBLE_TO_APPLY",
    );
  });
  it("matches the February retirement example and rolls October milestones into next April", () => {
    expect(proposedEligibilityDate("RETIREMENT_ONE_YEAR", d("2026-02-26")).date).toEqual(
      d("2027-04-01"),
    );
    expect(proposedEligibilityDate("RETIREMENT_ONE_YEAR", d("2026-10-02")).date).toEqual(
      d("2028-04-01"),
    );
  });
  it("keeps first-of-month and semiannual boundary ambiguity in HR review", () => {
    expect(
      proposedEligibilityDate("INSURANCE_60_DAYS", d("2026-01-31")).review,
    ).not.toBeNull();
    for (const date of ["2026-04-01", "2026-10-01"])
      expect(
        proposedEligibilityDate("RETIREMENT_ONE_YEAR", d(date)).review,
      ).not.toBeNull();
  });
  it("does not guess a non-leap-year February 29 anniversary", () => {
    expect(proposedEligibilityDate("RETIREMENT_ONE_YEAR", d("2024-02-29"))).toMatchObject(
      { date: null, review: expect.any(String) },
    );
  });
  it("rejects rolled calendar dates and malformed strings", () => {
    for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "10/28/2026", ""])
      expect(eligibilityDate(date)).toBeNull();
    expect(eligibilityDate("2024-02-29")).toEqual(d("2024-02-29"));
  });
  it("does not infer eligibility from employment type or a hire date", () => {
    expect(assessBenefitEligibility({ ...base, assessment: null }).state).toBe(
      "REVIEW_REQUIRED",
    );
    expect(
      assessBenefitEligibility({ ...base, policy: { ...policy, confirmed: false } })
        .state,
    ).toBe("REVIEW_REQUIRED");
    expect(
      assessBenefitEligibility({
        ...base,
        hireDate: null,
        assessment: { ...base.assessment, serviceDate: null },
      }).state,
    ).toBe("REVIEW_REQUIRED");
  });
  it("does not activate dental without its own confirmed policy", () => {
    expect(
      assessBenefitEligibility({ ...base, benefitType: "DENTAL", policy: null }).state,
    ).toBe("REVIEW_REQUIRED");
  });
  it("holds terminated, unapproved and HR-ineligible records without changing coverage", () => {
    expect(
      assessBenefitEligibility({ ...base, employmentStatus: "TERMINATED" }).state,
    ).toBe("NOT_ELIGIBLE");
    expect(
      assessBenefitEligibility({ ...base, employmentStatus: "PENDING_REVIEW" }).state,
    ).toBe("REVIEW_REQUIRED");
    expect(
      assessBenefitEligibility({
        ...base,
        assessment: { ...base.assessment, classification: "INELIGIBLE" },
      }).state,
    ).toBe("NOT_ELIGIBLE");
  });
  it("treats policy end as exclusive and refuses overlapping policy ambiguity", () => {
    const ended = { ...policy, effectiveTo: d("2026-10-28") };
    expect(effectiveEligibilityPolicy([ended], "MEDICAL", d("2026-10-28"))).toBeNull();
    expect(
      effectiveEligibilityPolicy(
        [policy, { ...policy, id: "second" }],
        "MEDICAL",
        d("2026-10-28"),
      ),
    ).toBeNull();
  });
});
