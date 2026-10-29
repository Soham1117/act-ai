import { z } from "zod";
import { emptyApplication, applicationSchema } from "@/lib/onboarding-packet";

const MAX_DRAFT_CHARS = 120_000;

export const onboardingDraftFieldsSchema = z.object({
  name: z.string().max(200).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  username: z.string().max(64).optional().nullable(),
  personalEmail: z.string().max(200).optional().nullable(),
  phoneNumber: z.string().max(40).optional().nullable(),
  dateOfBirth: z.string().max(40).optional().nullable(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  maritalStatus: z
    .enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED", "OTHER"])
    .optional()
    .nullable(),
  address: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  zipCode: z.string().max(20).optional().nullable(),
  nationality: z.string().max(100).optional().nullable(),
  educationLevel: z.string().max(100).optional().nullable(),
  ssnLast4: z.string().max(4).optional().nullable(),
  emergencyName: z.string().max(120).optional().nullable(),
  emergencyPhone: z.string().max(40).optional().nullable(),
  application: applicationSchema.optional(),
  drugPrintedName: z.string().max(120).optional().nullable(),
  drugAccepted: z.boolean().optional(),
  backgroundPrintedName: z.string().max(120).optional().nullable(),
  backgroundAccepted: z.boolean().optional(),
  ddBankName: z.string().max(120).optional().nullable(),
  ddBankLocation: z.string().max(120).optional().nullable(),
  ddRouting: z.string().max(9).optional().nullable(),
  ddAccount: z.string().max(34).optional().nullable(),
  ddAccountType: z.enum(["CHECKING", "SAVINGS"]).optional().nullable(),
  ddPrintedName: z.string().max(120).optional().nullable(),
  ddAccepted: z.boolean().optional(),
  handbookPrintedName: z.string().max(120).optional().nullable(),
  handbookAccepted: z.boolean().optional(),
  handbookChecklistItemId: z.string().max(64).optional().nullable(),
  nationalityOther: z.string().max(100).optional().nullable(),
  educationOther: z.string().max(100).optional().nullable(),
});

export const onboardingDraftSchema = z.object({
  step: z.number().int().min(0).max(20),
  fields: onboardingDraftFieldsSchema,
  savedAt: z.string().datetime().optional(),
});

export type OnboardingDraftFields = z.infer<typeof onboardingDraftFieldsSchema>;
export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;

export function draftStorageKey(token: string): string {
  return `act-onboard-draft:${token}`;
}

export function parseOnboardingDraft(raw: unknown): OnboardingDraft | null {
  const parsed = onboardingDraftSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function assertDraftSize(draft: OnboardingDraft): void {
  const size = JSON.stringify(draft).length;
  if (size > MAX_DRAFT_CHARS) {
    throw new Error("Draft is too large to save. Remove long comments and try again.");
  }
}

/** Strip secrets — never persist passwords. */
export function sanitizeDraftFields(
  fields: Record<string, unknown>,
): OnboardingDraftFields {
  const {
    password: _p,
    confirmPassword: _c,
    packet: _pkt,
    ...rest
  } = fields;
  void _p;
  void _c;
  void _pkt;
  const parsed = onboardingDraftFieldsSchema.safeParse(rest);
  return parsed.success ? parsed.data : {};
}

// Browser storage is readable by any script running on this origin. Keep only
// progress and a non-personal template selection; full answers belong in the
// encrypted server draft.
const browserDraftFieldsSchema = onboardingDraftFieldsSchema.pick({
  handbookChecklistItemId: true,
});
const browserDraftSchema = onboardingDraftSchema.extend({
  fields: browserDraftFieldsSchema,
});

export function sanitizeBrowserDraftFields(
  fields: Record<string, unknown>,
): OnboardingDraftFields {
  const parsed = browserDraftFieldsSchema.safeParse(fields);
  return parsed.success ? parsed.data : {};
}

export function sanitizeBrowserDraft(raw: unknown): OnboardingDraft | null {
  const parsed = browserDraftSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Remove old sensitive browser drafts before attempting a safe replacement. */
export function readBrowserDraft(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  token: string,
): OnboardingDraft | null {
  const key = draftStorageKey(token);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    storage.removeItem(key);
    const safe = sanitizeBrowserDraft(JSON.parse(raw));
    if (safe) storage.setItem(key, JSON.stringify(safe));
    return safe;
  } catch {
    return null;
  }
}

/** A public invite link must never return saved bank numbers. */
export function redactDraftBankDetails(draft: OnboardingDraft): OnboardingDraft {
  const { ddRouting: _routing, ddAccount: _account, ...fields } = draft.fields;
  void _routing;
  void _account;
  return { ...draft, fields: { ...fields, ddAccepted: false } };
}

export function draftFromInvite(invite: {
  draftJson: unknown;
  draftStep: number | null;
}): OnboardingDraft | null {
  const parsed = parseOnboardingDraft(invite.draftJson);
  if (parsed) return parsed;
  if (invite.draftStep != null && invite.draftStep >= 0) {
    return { step: invite.draftStep, fields: {} };
  }
  return null;
}

export function mergeDraftApplication(
  draftApp: OnboardingDraftFields["application"] | undefined,
  suggestedJobTitle: string,
) {
  const base = emptyApplication();
  if (suggestedJobTitle.trim()) base.positionApplied = suggestedJobTitle.trim();
  if (!draftApp) return base;
  return {
    ...base,
    ...draftApp,
    highSchool: { ...base.highSchool, ...draftApp.highSchool },
    vocational: { ...base.vocational, ...draftApp.vocational },
    college: { ...base.college, ...draftApp.college },
    gradSchool: { ...base.gradSchool, ...draftApp.gradSchool },
    employers:
      draftApp.employers?.length ? draftApp.employers : base.employers,
    references:
      draftApp.references?.length ? draftApp.references : base.references,
    positionApplied:
      draftApp.positionApplied?.trim() ||
      base.positionApplied ||
      null,
  };
}
