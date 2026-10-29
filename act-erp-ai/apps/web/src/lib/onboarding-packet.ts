import { z } from "zod";
import { handbookReceiptText } from "@/lib/onboarding-checklist";

/** Versioned legal copy shown on the invite. Bump when ACT updates form language. */
export const ONBOARDING_CONSENT_VERSION = "act-2026-new-hire-v1";

export const DRUG_ALCOHOL_CONSENT_TEXT = `Pre-employment drug/alcohol testing consent and release (American Completion Tools)

I voluntarily consent to pre-employment drug and/or alcohol testing as a condition of employment with American Completion Tools. I authorize the collection of specimens and the release of test results to the Company and its authorized agents for employment decisions. I understand that a positive test, refusal to test, or adulteration may result in withdrawal of a job offer or other employment action. I release American Completion Tools, its agents, and the testing laboratory from claims arising from authorized testing conducted in accordance with applicable law, except for willful misconduct.`;

export const BACKGROUND_CHECK_CONSENT_TEXT = `Background check authorization (American Completion Tools)

I authorize American Completion Tools and its agents to obtain consumer reports and/or investigative consumer reports about me for employment purposes, including criminal history, employment and education verification, and motor vehicle records where job-related. I certify that the information I provide is true and complete. I understand I may receive a copy of any report and a summary of my rights under the Fair Credit Reporting Act, and that adverse action (if any) will follow applicable notice procedures.`;

export const DIRECT_DEPOSIT_ACK_TEXT = `Direct deposit authorization (American Completion Tools)

I authorize American Completion Tools to deposit my pay electronically to the account listed below and to initiate correcting entries if a deposit is made in error. I understand I am responsible for the accuracy of the bank information and for notifying the Company of any account changes. This authorization remains in effect until I revoke it in writing with reasonable notice.`;

const emptyToNull = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? emptyToNull(v) : v),
    z.string().max(max).nullable().optional(),
  );

const educationRow = z.object({
  name: optionalText(120),
  location: optionalText(120),
  studies: optionalText(120),
  degree: optionalText(80),
});

const employerRow = z.object({
  name: optionalText(120),
  address: optionalText(200),
  telephone: optionalText(40),
  supervisor: optionalText(120),
  position: optionalText(120),
  duties: optionalText(500),
  startDate: optionalText(40),
  endDate: optionalText(40),
  salaryStart: optionalText(40),
  salaryEnd: optionalText(40),
  reasonForLeaving: optionalText(200),
  mayContact: z.enum(["YES", "NO", "NA"]).optional().nullable(),
});

const referenceRow = z.object({
  name: optionalText(120),
  title: optionalText(120),
  company: optionalText(120),
  contact: optionalText(120),
});

export const applicationSchema = z.object({
  positionApplied: optionalText(120),
  dateCanBegin: optionalText(40),
  minSalary: optionalText(40),
  overtimeOk: z.enum(["YES", "NO"]).optional().nullable(),
  workInUsa: z.enum(["YES", "NO"]).optional().nullable(),
  previouslyWorkedAtAct: z.enum(["YES", "NO"]).optional().nullable(),
  relativesAtAct: z.enum(["YES", "NO"]).optional().nullable(),
  relativesExplain: optionalText(300),
  driversLicenseNumber: optionalText(40),
  driversLicenseState: optionalText(10),
  previousAddress: optionalText(200),
  previousCity: optionalText(100),
  previousState: optionalText(10),
  previousZip: optionalText(20),
  previousAddressDates: optionalText(80),
  highSchool: educationRow.optional(),
  vocational: educationRow.optional(),
  college: educationRow.optional(),
  gradSchool: educationRow.optional(),
  employers: z.array(employerRow).max(3).default([]),
  militaryService: z.enum(["YES", "NO"]).optional().nullable(),
  militaryBranch: optionalText(80),
  militaryServiceNo: optionalText(80),
  militaryTraining: optionalText(300),
  felony: z.enum(["YES", "NO"]).optional().nullable(),
  felonyExplain: optionalText(500),
  references: z.array(referenceRow).max(5).default([]),
  comments: optionalText(1000),
});

export const consentAckSchema = z.object({
  accepted: z.literal(true),
  printedName: z.string().trim().min(2).max(120),
  textVersion: z.literal(ONBOARDING_CONSENT_VERSION),
});

export const directDepositSchema = z.object({
  bankName: z.string().trim().min(2).max(120),
  bankLocation: optionalText(120),
  routingNumber: z
    .string()
    .trim()
    .regex(/^\d{9}$/, "Routing number must be 9 digits"),
  accountNumber: z
    .string()
    .trim()
    .min(4)
    .max(34)
    .regex(/^[0-9A-Za-z-]+$/, "Enter a valid account number"),
  accountType: z.enum(["CHECKING", "SAVINGS"]),
  printedName: z.string().trim().min(2).max(120),
  accepted: z.literal(true),
  textVersion: z.literal(ONBOARDING_CONSENT_VERSION),
});

export const handbookAckSchema = z.object({
  accepted: z.literal(true),
  printedName: z.string().trim().min(2).max(120),
  checklistItemId: z.string().min(1).optional().nullable(),
  versionId: z.string().min(1).optional().nullable(),
  title: z.string().trim().min(1).max(200).optional().nullable(),
  versionNumber: z.number().int().positive().optional().nullable(),
});

export const packetPayloadSchema = z.object({
  application: applicationSchema,
  drugAlcohol: consentAckSchema,
  background: consentAckSchema,
  directDeposit: directDepositSchema,
  handbook: handbookAckSchema,
});

export type OnboardingPacketPayload = z.infer<typeof packetPayloadSchema>;
export type OnboardingApplication = z.infer<typeof applicationSchema>;

export function emptyApplication(): OnboardingApplication {
  return {
    positionApplied: null,
    dateCanBegin: null,
    minSalary: null,
    overtimeOk: null,
    workInUsa: null,
    previouslyWorkedAtAct: null,
    relativesAtAct: null,
    relativesExplain: null,
    driversLicenseNumber: null,
    driversLicenseState: null,
    previousAddress: null,
    previousCity: null,
    previousState: null,
    previousZip: null,
    previousAddressDates: null,
    highSchool: { name: null, location: null, studies: null, degree: null },
    vocational: { name: null, location: null, studies: null, degree: null },
    college: { name: null, location: null, studies: null, degree: null },
    gradSchool: { name: null, location: null, studies: null, degree: null },
    employers: [
      emptyEmployer(),
      emptyEmployer(),
      emptyEmployer(),
    ],
    militaryService: null,
    militaryBranch: null,
    militaryServiceNo: null,
    militaryTraining: null,
    felony: null,
    felonyExplain: null,
    references: [
      emptyReference(),
      emptyReference(),
      emptyReference(),
    ],
    comments: null,
  };
}

function emptyEmployer(): z.infer<typeof employerRow> {
  return {
    name: null,
    address: null,
    telephone: null,
    supervisor: null,
    position: null,
    duties: null,
    startDate: null,
    endDate: null,
    salaryStart: null,
    salaryEnd: null,
    reasonForLeaving: null,
    mayContact: null,
  };
}

function emptyReference(): z.infer<typeof referenceRow> {
  return { name: null, title: null, company: null, contact: null };
}

export function buildHandbookAckText(
  title: string | null | undefined,
  version: number | null | undefined,
  language: "en" | "es" = "en",
): string {
  return handbookReceiptText(title?.trim() || "Employee Handbook", version ?? 1, language);
}

export function maskAccountNumber(account: string): string {
  const digits = account.replace(/\s/g, "");
  if (digits.length <= 4) return "••••";
  return `${"•".repeat(Math.min(digits.length - 4, 8))}${digits.slice(-4)}`;
}

export type HandbookTemplateOption = {
  checklistItemId: string;
  versionId: string;
  title: string;
  version: number;
  downloadHref: string;
};
