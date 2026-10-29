import { z } from "zod";

export const COMPANY_CATEGORIES = {
  ONBOARDING: "Onboarding forms",
  HANDBOOK: "Company handbook",
  BENEFITS: "Benefit resources",
  PAYROLL_COMPLIANCE: "Payroll compliance",
  YEAR_END_TAX: "Year-end tax forms",
  PAYROLL_SUMMARY: "Payroll summaries",
  CORPORATE_TAX: "Corporate tax",
  HR_REFERENCE: "HR reference",
} as const;
export type CompanyCategory = keyof typeof COMPANY_CATEGORIES;
export const COMPANY_PURPOSES = {
  HR_ONLY: "HR only",
  ONBOARDING_TEMPLATE: "Onboarding template",
  BENEFIT_RESOURCE: "Benefit resource",
} as const;

const optionalDate = z.string().optional().transform((v) => v?.trim() || null).refine((v) => {
  if (!v) return true;
  const date = new Date(`${v}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
}, "Enter a valid calendar date.");
const optionalNumber = (min: number, max: number) => z.union([z.number().int().min(min).max(max), z.literal("")]).optional().transform((v) => typeof v === "number" ? v : null);
export const companyDocumentSchema = z.object({
  documentId: z.string().min(1).optional(),
  title: z.string().trim().min(2).max(200),
  category: z.enum(Object.keys(COMPANY_CATEGORIES) as [CompanyCategory, ...CompanyCategory[]]),
  issuer: z.string().trim().max(150).optional(),
  year: optionalNumber(1900, 2200),
  quarter: optionalNumber(1, 4),
  periodStart: optionalDate,
  periodEnd: optionalDate,
  effectiveDate: optionalDate,
  sourceReference: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
}).refine((v) => !v.periodStart || !v.periodEnd || v.periodEnd >= v.periodStart, {
  message: "Period end must be on or after its start.", path: ["periodEnd"],
}).refine((v) => !v.quarter || !!v.year, { message: "Enter a year for the quarter.", path: ["year"] });
export type CompanyDocumentInput = z.input<typeof companyDocumentSchema>;

export function allowedCompanyPurpose(category: string, purpose: string): boolean {
  if (purpose === "HR_ONLY") return category in COMPANY_CATEGORIES;
  if (purpose === "ONBOARDING_TEMPLATE") return category === "ONBOARDING" || category === "HANDBOOK";
  return purpose === "BENEFIT_RESOURCE" && category === "BENEFITS";
}

export function usableOnboardingVersion(v: {status: string; purpose: string; document: {category: string; isArchived: boolean}}): boolean {
  return v.status === "APPROVED" && v.purpose === "ONBOARDING_TEMPLATE" && !v.document.isArchived &&
    (v.document.category === "ONBOARDING" || v.document.category === "HANDBOOK");
}
