import { describe, expect, it } from "vitest";
import { allowedCompanyPurpose, companyDocumentSchema, usableOnboardingVersion } from "./company-documents";

describe("company document boundaries", () => {
  it.each(["PAYROLL_COMPLIANCE", "YEAR_END_TAX", "PAYROLL_SUMMARY", "CORPORATE_TAX"])("keeps %s out of employee resources", (category) => {
    expect(allowedCompanyPurpose(category, "ONBOARDING_TEMPLATE")).toBe(false);
    expect(allowedCompanyPurpose(category, "BENEFIT_RESOURCE")).toBe(false);
    expect(allowedCompanyPurpose(category, "HR_ONLY")).toBe(true);
  });
  it("requires exact approval, purpose, category and active parent for an invite template", () => {
    const v = {status: "APPROVED", purpose: "ONBOARDING_TEMPLATE", document: {category: "HANDBOOK", isArchived: false}};
    expect(usableOnboardingVersion(v)).toBe(true);
    expect(usableOnboardingVersion({...v, status: "DRAFT"})).toBe(false);
    expect(usableOnboardingVersion({...v, purpose: "HR_ONLY"})).toBe(false);
    expect(usableOnboardingVersion({...v, document: {...v.document, isArchived: true}})).toBe(false);
    expect(usableOnboardingVersion({...v, document: {...v.document, category: "YEAR_END_TAX"}})).toBe(false);
  });
  it("rejects invalid calendar dates and reversed periods without throwing", () => {
    const base = {title: "Return", category: "PAYROLL_COMPLIANCE"};
    for (const date of ["2026-02-30", "2026-99-01", "not-a-date"]) expect(companyDocumentSchema.safeParse({...base, effectiveDate: date}).success).toBe(false);
    expect(companyDocumentSchema.safeParse({...base, periodStart: "2026-10-02", periodEnd: "2026-10-01"}).success).toBe(false);
    expect(companyDocumentSchema.safeParse({...base, effectiveDate: "2024-02-29", quarter: 3}).success).toBe(false);
    expect(companyDocumentSchema.safeParse({...base, effectiveDate: "2024-02-29", year: 2024, quarter: 3}).success).toBe(true);
  });
});
