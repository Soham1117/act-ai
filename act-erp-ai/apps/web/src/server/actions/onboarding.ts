"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { encryptEmployeePrivateDetails } from "@/server/employee-private-data";
import { requireAdmin } from "@/lib/auth";
import { hashPassword } from "@/lib/auth/password";
import { uploadFile, deleteFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { notifyAdmins } from "@/lib/notify";
import { rateLimited } from "@/lib/rate-limit";
import { validateUpload } from "@/lib/upload-validation";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { generateEmployeeId } from "@/lib/employee-create";
import { DEFAULT_KIOSK_PIN } from "@/lib/kiosk-pin";
import { optionalNormalizedEmail, optionalNormalizedUsername } from "@/lib/identity";
import { checkDateOfBirth, checkDateOfHire } from "@/lib/employee-validation";
import {
  ONBOARDING_CONSENT_VERSION,
  BACKGROUND_CHECK_CONSENT_TEXT,
  DRUG_ALCOHOL_CONSENT_TEXT,
  DIRECT_DEPOSIT_ACK_TEXT,
  buildHandbookAckText,
  packetPayloadSchema,
  type OnboardingPacketPayload,
} from "@/lib/onboarding-packet";
import { handbookReceiptText } from "@/lib/onboarding-checklist";
import {
  assertDraftSize,
  onboardingDraftSchema,
  sanitizeDraftFields,
  type OnboardingDraft,
} from "@/lib/onboarding-draft";

import { encryptSensitiveJson } from "@/server/sensitive-data";
import {
  encryptOnboardingPacketFields,
  onboardingDraftContext,
} from "@/server/onboarding-sensitive-data";

const INVITE_TTL_DAYS = 7;
const MAX_DOCS = 12;
const MAX_TOTAL_DOC_BYTES = 40 * 1024 * 1024;

const onboardingFieldLabels: Record<string, string> = {
  name: "nombre",
  email: "correo laboral",
  username: "nombre de usuario",
  personalEmail: "correo personal",
  password: "contraseña",
  phoneNumber: "teléfono",
  dateOfBirth: "fecha de nacimiento",
  gender: "género",
  maritalStatus: "estado civil",
  address: "dirección",
  city: "ciudad",
  state: "estado",
  zipCode: "código postal",
  nationality: "nacionalidad",
  educationLevel: "nivel educativo",
  ssnLast4: "últimos cuatro dígitos del Seguro Social",
  emergencyName: "contacto de emergencia",
  emergencyPhone: "teléfono de emergencia",
};

/* -------------------------------------------------------------------------- */
/* Admin: invites                                                             */
/* -------------------------------------------------------------------------- */

const inviteSchema = z.object({
  email: optionalNormalizedEmail,
  // Everything below is decided by the admin; the new hire cannot change it.
  departmentId: z.string().optional().nullable(),
  jobTitle: z.string().trim().max(120).optional().nullable(),
  employmentType: z.enum(["FULL_PART_TIME", "CONTRACT_HOURLY"]),
  compensationType: z.enum(["MONTHLY_SALARY", "HOURLY_RATE", "TOTAL_COMPENSATION"]),
  compensationValue: z.coerce
    .number()
    .min(0, "Pay can't be negative")
    .optional()
    .nullable(),
  dateOfHire: z.string().optional().nullable(),
});

/** Admin: create a new onboarding invite with the hire's terms pre-set. */
export type OnboardingInviteInput = {
  email?: string;
  departmentId?: string | null;
  jobTitle?: string | null;
  employmentType: "FULL_PART_TIME" | "CONTRACT_HOURLY";
  compensationType: "MONTHLY_SALARY" | "HOURLY_RATE" | "TOTAL_COMPENSATION";
  compensationValue?: number | null;
  dateOfHire?: string | null;
};

export async function createOnboardingInvite(
  input: OnboardingInviteInput,
): Promise<ActionResult<{ id: string; token: string }>> {
  const admin = await requireAdmin();
  try {
    const data = inviteSchema.parse(input);

    if (data.departmentId) {
      const dept = await db.department.findUnique({
        where: { id: data.departmentId },
        select: { id: true },
      });
      if (!dept)
        return fail(
          "That department no longer exists. Refresh and pick another.",
          "errors.onboarding.thatDepartmentNoLongerExistsRefresh_2fe3f",
        );
    }
    let dateOfHire: Date | null = null;
    if (data.dateOfHire) {
      const c = checkDateOfHire(data.dateOfHire);
      if (!c.ok) return fail(c.error, "businessErrors.onboarding.invalidHireDate");
      dateOfHire = c.date;
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const invite = await db.onboardingInvite.create({
      data: {
        token,
        email: data.email ?? null,
        expiresAt,
        createdById: admin.id,
        departmentId: data.departmentId || null,
        jobTitle: data.jobTitle || null,
        employmentType: data.employmentType,
        compensationType: data.compensationType,
        compensationValue: data.compensationValue ?? null,
        dateOfHire,
      },
    });
    await audit({
      action: "onboarding.invite_create",
      resource: `OnboardingInvite:${invite.id}`,
      diff: {
        email: data.email ?? null,
        departmentId: data.departmentId || null,
        jobTitle: data.jobTitle || null,
        employmentType: data.employmentType,
        compensationType: data.compensationType,
        dateOfHire: dateOfHire?.toISOString().slice(0, 10) ?? null,
      },
    });
    revalidatePath("/admin/onboarding");
    return ok({ id: invite.id, token: invite.token });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Admin: revoke (mark expired) an outstanding invite. */
export async function revokeOnboardingInvite(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const res = await db.onboardingInvite.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "EXPIRED",
        expiresAt: new Date(0),
        draftJson: Prisma.DbNull,
        draftStep: null,
        draftUpdatedAt: null,
      },
    });
    if (res.count === 0) {
      return fail(
        "This invite was already used or revoked. Refresh the page.",
        "errors.onboarding.thisInviteWasAlreadyUsedOr_5f4fa",
      );
    }
    await audit({
      action: "onboarding.invite_revoke",
      resource: `OnboardingInvite:${id}`,
    });
    revalidatePath("/admin/onboarding");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

/* -------------------------------------------------------------------------- */
/* Public: draft (resume mid-wizard)                                          */
/* -------------------------------------------------------------------------- */

export type OnboardingDraftInput = {
  step: number;
  fields: Record<string, unknown>;
};

/** Public: save in-progress hire packet (never stores password). */
export async function saveOnboardingDraft(
  token: string,
  input: OnboardingDraftInput,
): Promise<ActionResult<{ savedAt: string }>> {
  // Use request start time, never a client-provided time or KMS completion time.
  const saveStartedAt = new Date();
  try {
    if (typeof token !== "string" || token.length < 8 || token.length > 100) {
      return fail(
        "This onboarding invite was not found. Ask your admin for a new invite link.",
        "errors.onboarding.thisOnboardingInviteWasNotFound_77f61",
      );
    }
    if (rateLimited(`onboard-draft:${token}`, 60, 60_000)) {
      return fail(
        "Too many draft saves. Wait a moment and continue.",
        "errors.onboarding.draftRateLimit",
      );
    }

    const invite = await db.onboardingInvite.findUnique({
      where: { token },
      select: { id: true, status: true, expiresAt: true },
    });
    if (!invite || invite.status !== "PENDING" || invite.expiresAt < new Date()) {
      return fail(
        "This onboarding invite is no longer open.",
        "errors.onboarding.inviteNotOpen",
      );
    }

    const draft: OnboardingDraft = onboardingDraftSchema.parse({
      step: input.step,
      fields: sanitizeDraftFields(input.fields ?? {}),
      savedAt: saveStartedAt.toISOString(),
    });
    assertDraftSize(draft);

    const encryptedDraft = await encryptSensitiveJson(draft, onboardingDraftContext(invite.id));
    // KMS may finish out of order. Never overwrite newer answers or a closed draft.
    const saved = await db.onboardingInvite.updateMany({
      where: {
        id: invite.id,
        status: "PENDING",
        expiresAt: { gt: new Date() },
        OR: [
          { draftUpdatedAt: null },
          { draftUpdatedAt: { lt: saveStartedAt } },
        ],
      },
      data: {
        draftJson: encryptedDraft,
        draftStep: draft.step,
        draftUpdatedAt: saveStartedAt,
      },
    });
    if (saved.count !== 1) {
      return fail("Draft was not saved. Try saving again.");
    }
    return ok({ savedAt: draft.savedAt! });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/* -------------------------------------------------------------------------- */
/* Public: submit                                                             */
/* -------------------------------------------------------------------------- */

// The hire supplies only personal/account details. Employee ID, department,
// title, hire date, employment type and pay come from the admin's invite.
const submitSchema = z
  .object({
    name: z.string().trim().min(2),
    // Optional — some hires (part-time / shop floor) have no company email at
    // all. If omitted, `username` is required instead as the login identifier.
    email: optionalNormalizedEmail,
    username: optionalNormalizedUsername,
    // Optional while password-only login is enabled. Retained so 2FA can be
    // restored later without changing the onboarding data model again.
    personalEmail: optionalNormalizedEmail,
    password: z.string().min(8, "Password must be at least 8 characters").max(72),
    phoneNumber: z.string().trim().max(40).optional().nullable(),
    dateOfBirth: z.string().optional().nullable(),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
    maritalStatus: z
      .enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED", "OTHER"])
      .optional()
      .nullable(),
    // Address
    address: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().max(100).optional().nullable(),
    state: z.string().trim().max(100).optional().nullable(),
    zipCode: z.string().trim().max(20).optional().nullable(),
    nationality: z.string().trim().max(100).optional().nullable(),
    educationLevel: z.string().trim().max(100).optional().nullable(),
    // Identity / emergency
    // Last 4 digits only — we deliberately never collect the full SSN.
    ssnLast4: z.string().regex(/^\d{4}$/, "Enter the last 4 digits of your SSN"),
    emergencyName: z.string().trim().max(120).optional().nullable(),
    emergencyPhone: z.string().trim().max(40).optional().nullable(),
    packet: packetPayloadSchema,
  })
  .refine((v) => v.email || v.username, {
    message: "Provide either a work email or a username",
    path: ["username"],
  });

/** What the public form sends (the schema normalises/validates it again). */
export type OnboardingSubmit = {
  name: string;
  email?: string;
  username?: string;
  personalEmail?: string;
  password: string;
  phoneNumber?: string | null;
  dateOfBirth?: string | null;
  gender: "MALE" | "FEMALE" | "OTHER";
  maritalStatus?:
    | "SINGLE"
    | "MARRIED"
    | "DIVORCED"
    | "WIDOWED"
    | "SEPARATED"
    | "OTHER"
    | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  nationality?: string | null;
  educationLevel?: string | null;
  ssnLast4: string;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  packet: OnboardingPacketPayload;
};

const DOC_TYPES = ["PERSONAL", "ONBOARDING", "BENEFITS", "TRAINING"] as const;

export type OnboardingFileInput = {
  fileName: string;
  title: string;
  documentType: (typeof DOC_TYPES)[number];
  contentType: string;
  /** Base64-encoded file bytes (the form encodes via FileReader). */
  base64: string;
};

/**
 * Public: submit completed onboarding data with optional document files.
 *
 * All-or-nothing:
 *   1. Check the invite token (friendly errors), validate fields and EVERY
 *      file (extension allowlist + magic bytes + size). Any problem returns an
 *      error naming the offending file and nothing is created.
 *   2. Store the files in S3.
 *   3. One DB transaction: atomically claim the invite (PENDING -> COMPLETED
 *      via updateMany), generate the next EMP-YYYY-NNNN, create User +
 *      Employee (employmentStatus PENDING_REVIEW, pay/dept/title from the
 *      invite) and the Document rows. If it fails, stored files are removed.
 *   4. Notify admins to review and approve.
 */
export async function submitOnboarding(
  token: string,
  fields: OnboardingSubmit,
  files: OnboardingFileInput[],
): Promise<ActionResult> {
  const uploadedKeys: string[] = [];
  try {
    if (typeof token !== "string" || token.length < 8 || token.length > 100) {
      return fail(
        "This onboarding invite was not found. Ask your admin for a new invite link.",
        "errors.onboarding.thisOnboardingInviteWasNotFound_77f61",
      );
    }
    if (rateLimited(`onboard:${token}`, 15, 15 * 60_000)) {
      return fail(
        "Too many attempts. Wait a few minutes and try again.",
        "errors.onboarding.tooManyAttemptsWaitAFew_76d7a",
      );
    }

    const invite = await db.onboardingInvite.findUnique({ where: { token } });
    if (!invite) {
      return fail(
        "This onboarding invite was not found. Ask your admin for a new invite link.",
        "errors.onboarding.thisOnboardingInviteWasNotFound_77f61",
      );
    }
    if (invite.status !== "PENDING") {
      return fail(
        "This onboarding invite was already used. Sign in if you already finished, or ask your admin for a new invite.",
        "errors.onboarding.thisOnboardingInviteWasAlreadyUsed_3d1a0",
      );
    }
    if (invite.expiresAt < new Date()) {
      return fail(
        "This onboarding invite has expired. Ask your admin to send a new invite link.",
        "errors.onboarding.thisOnboardingInviteHasExpiredAsk_420fc",
      );
    }

    const parsed = submitSchema.safeParse(fields);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path.length ? `${first.path.join(".")}: ` : "";
      const message = first?.message ?? "Some fields are invalid.";
      const field = onboardingFieldLabels[String(first?.path[0] ?? "")] ?? "información";
      return fail(
        `Check your details. ${where}${message}`,
        "businessErrors.onboarding.invalidFields",
        { field },
      );
    }
    const data = parsed.data;
    const packet = data.packet;
    if (
      packet.drugAlcohol.textVersion !== ONBOARDING_CONSENT_VERSION ||
      packet.background.textVersion !== ONBOARDING_CONSENT_VERSION ||
      packet.directDeposit.textVersion !== ONBOARDING_CONSENT_VERSION
    ) {
      return fail(
        "Consent text was updated. Refresh the page and re-acknowledge before submitting.",
        "errors.onboarding.consentVersionMismatch",
      );
    }

    let dateOfBirth: Date | null = null;
    if (data.dateOfBirth) {
      const c = checkDateOfBirth(data.dateOfBirth);
      if (!c.ok) return fail(c.error, "businessErrors.onboarding.invalidBirthDate");
      dateOfBirth = c.date;
    }

    // Friendly duplicate checks (the unique indexes remain the real guard).
    const dupe = await db.user.findFirst({
      where: {
        OR: [
          ...(data.email ? [{ email: data.email }] : []),
          ...(data.username ? [{ username: data.username }] : []),
        ],
      },
      select: { email: true, username: true },
    });
    if (dupe) {
      return fail(
        data.email && dupe.email === data.email
          ? "That work email already has an account. Sign in instead, or use a different email."
          : "That username is already taken. Pick another.",
        data.email && dupe.email === data.email
          ? "businessErrors.onboarding.duplicateAccount"
          : "businessErrors.onboarding.duplicateUsername",
      );
    }
    if (data.email) {
      const e = await db.employee.findUnique({
        where: { email: data.email },
        select: { id: true },
      });
      if (e)
        return fail(
          "That work email is already on an employee record. Use a different email.",
          "errors.onboarding.thatWorkEmailIsAlreadyOn_6182a",
        );
    }

    // ---- validate every file before touching storage -------------------------
    if (files.length > MAX_DOCS)
      return fail(
        `Upload at most ${MAX_DOCS} documents.`,
        "businessErrors.onboarding.documentLimit",
        { count: MAX_DOCS },
      );
    const prepared: Array<{
      title: string;
      documentType: (typeof DOC_TYPES)[number];
      bytes: Buffer;
      v: Extract<ReturnType<typeof validateUpload>, { ok: true }>;
    }> = [];
    let total = 0;
    const problems: string[] = [];
    const problemLabels: string[] = [];
    for (const f of files) {
      const label = f.title?.trim() || f.fileName;
      if (!DOC_TYPES.includes(f.documentType)) {
        problems.push(`${label}: unknown document type.`);
        problemLabels.push(label);
        continue;
      }
      const bytes = Buffer.from(f.base64 ?? "", "base64");
      total += bytes.byteLength;
      const v = validateUpload("document", { name: f.fileName ?? "", bytes });
      if (!v.ok) {
        problems.push(`${label}: ${v.error}`);
        problemLabels.push(label);
        continue;
      }
      prepared.push({
        title: (f.title?.trim() || v.baseName).slice(0, 120),
        documentType: f.documentType,
        bytes,
        v,
      });
    }
    if (total > MAX_TOTAL_DOC_BYTES) {
      problems.push(
        `Documents are too large in total (max ${MAX_TOTAL_DOC_BYTES / (1024 * 1024)} MB).`,
      );
    }
    if (problems.length) {
      return fail(
        `Nothing was submitted. Fix these files and try again: ${problems.join(" ")}`,
        "businessErrors.onboarding.documentUpload",
        { files: problemLabels.join(", ") || "adjuntos" },
      );
    }

    // Protect all packet sections before uploads or database writes. No plaintext fallback.
    const handbookStored = {
      ...packet.handbook,
      acknowledgmentText: buildHandbookAckText(
        packet.handbook.title,
        packet.handbook.versionNumber ?? null,
      ),
      consentTexts: {
        drugAlcohol: DRUG_ALCOHOL_CONSENT_TEXT,
        background: BACKGROUND_CHECK_CONSENT_TEXT,
        directDeposit: DIRECT_DEPOSIT_ACK_TEXT,
      },
    };
    const acceptedAt = new Date().toISOString();
    const encryptedPacket = await encryptOnboardingPacketFields(invite.id, {
      application: packet.application,
      drugAlcohol: {
        ...packet.drugAlcohol,
        legalText: DRUG_ALCOHOL_CONSENT_TEXT,
        acceptedAt,
      },
      background: {
        ...packet.background,
        legalText: BACKGROUND_CHECK_CONSENT_TEXT,
        acceptedAt,
      },
      directDeposit: {
        ...packet.directDeposit,
        legalText: DIRECT_DEPOSIT_ACK_TEXT,
        acceptedAt,
      },
      handbook: handbookStored,
    });

    const employeeRecordId = randomUUID();
    const privateWrite = await encryptEmployeePrivateDetails(employeeRecordId, {
      personalEmail: data.personalEmail ?? null, phoneNumber: data.phoneNumber || null,
      dateOfBirth, address: data.address || null, city: data.city || null,
      state: data.state || null, zipCode: data.zipCode || null, ssnLast4: data.ssnLast4,
      emergencyName: data.emergencyName || null, emergencyPhone: data.emergencyPhone || null,
    });
    const [passwordHash, kioskPinHash] = await Promise.all([
      hashPassword(data.password),
      hashPassword(DEFAULT_KIOSK_PIN),
    ]);

    // ---- store files first; DB rows are created inside the transaction --------
    const stored: Array<(typeof prepared)[number] & { path: string; key: string }> = [];
    for (const p of prepared) {
      const path = `onboarding/${invite.id}/${Date.now()}-${randomUUID().slice(0, 8)}-${p.v.safeFileName}`;
      const { key } = await uploadFile("documents", path, p.bytes, {
        contentType: p.v.contentType,
      });
      uploadedKeys.push(path);
      stored.push({ ...p, path, key });
    }

    const employee = await db.$transaction(async (tx) => {
      // Serialize template assignment with invite completion. Existing punch,
      // kiosk, and employee-account approval behavior is unchanged.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`onboarding-owner:invite:${invite.id}`}))`;
      // Atomic claim: only one submission can move the invite off PENDING.
      const claim = await tx.onboardingInvite.updateMany({
        where: { id: invite.id, status: "PENDING", expiresAt: { gt: new Date() } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      if (claim.count !== 1) {
        throw new Error("This onboarding invite was already used or has expired.");
      }

      const employeeId = await generateEmployeeId(tx);
      // The department may have been removed after the invite was issued.
      const deptId = invite.departmentId
        ? ((
            await tx.department.findUnique({
              where: { id: invite.departmentId },
              select: { id: true },
            })
          )?.id ?? null)
        : null;

      const user = await tx.user.create({
        data: {
          email: data.email ?? null,
          username: data.username ?? null,
          name: data.name,
          role: "EMPLOYEE",
          passwordHash,
        },
      });
      const emp = await tx.employee.create({
        data: {
          id: employeeRecordId,
          employeeId,
          userId: user.id,
          name: data.name,
          email: data.email ?? null,
          gender: data.gender,
          maritalStatus: data.maritalStatus ?? null,
          nationality: data.nationality || null,
          educationLevel: data.educationLevel || null,
          // Admin-decided terms from the invite:
          departmentId: deptId,
          jobTitle: invite.jobTitle,
          dateOfHire: invite.dateOfHire,
          employmentType: invite.employmentType ?? "FULL_PART_TIME",
          compensationType: invite.compensationType ?? "HOURLY_RATE",
          compensationValue: invite.compensationValue,
          employmentStatus: "PENDING_REVIEW",
          kioskPinHash,
          ...privateWrite,
        },
      });
      for (const s of stored) {
        await tx.document.create({
          data: {
            title: s.title,
            fileName: s.path,
            fileType: s.v.contentType,
            // Legacy column — reads go through /api/documents/[id]/file.
            fileUrl: s.key,
            documentType: s.documentType,
            employeeId: emp.id,
          },
        });
      }

      await tx.onboardingPacketSubmission.create({
        data: {
          inviteId: invite.id,
          employeeId: emp.id,
          consentVersion: ONBOARDING_CONSENT_VERSION,
          ...encryptedPacket,
        },
      });

      // Attach invite checklist to the new employee, then record handbook receipt
      // when the hire acknowledged an assigned handbook template.
      const checklistItems = await tx.onboardingChecklistItem.findMany({
        where: { inviteId: invite.id },
        include: { version: { include: { document: true } }, acknowledgment: true },
      });
      await tx.onboardingChecklistItem.updateMany({
        where: { inviteId: invite.id },
        data: { employeeId: emp.id, inviteId: null },
      });

      const handbookItemId = packet.handbook.checklistItemId ?? null;
      if (handbookItemId) {
        const item = checklistItems.find((i) => i.id === handbookItemId);
        if (
          item &&
          item.itemType === "HANDBOOK" &&
          !item.acknowledgment &&
          item.versionId === (packet.handbook.versionId ?? item.versionId)
        ) {
          await tx.handbookAcknowledgment.create({
            data: {
              checklistItemId: item.id,
              employeeId: emp.id,
              versionId: item.versionId,
              acknowledgmentText: handbookReceiptText(
                item.title,
                item.version.version,
              ),
              method: "ELECTRONIC",
              actorId: user.id,
            },
          });
          await tx.onboardingChecklistItem.update({
            where: { id: item.id },
            data: {
              employeeId: emp.id,
              inviteId: null,
              status: "SUBMITTED",
              reviewedAt: null,
              reviewedById: null,
            },
          });
        }
      }

      await tx.onboardingInvite.update({
        where: { id: invite.id },
        data: {
          completedByEmployeeId: emp.id,
          draftJson: Prisma.DbNull,
          draftStep: null,
          draftUpdatedAt: null,
        },
      });
      return { ...emp, loginUserId: user.id };
    });

    await audit({
      action: "onboarding.complete",
      resource: `Employee:${employee.id}`,
      actor: { id: employee.loginUserId, email: data.email ?? null },
      diff: {
        employeeId: employee.employeeId,
        email: data.email ?? null,
        username: data.username ?? null,
        documents: stored.length,
        packet: true,
        status: "PENDING_REVIEW",
      },
    });
    await notifyAdmins({
      type: "SYSTEM",
      title: "New hire awaiting approval",
      message: `${data.name} (${employee.employeeId}) finished onboarding. Review their details and approve the account.`,
      link: `/admin/employees/${employee.id}`,
      priority: "HIGH",
    });
    revalidatePath("/admin/onboarding");
    revalidatePath("/admin/employees");
    return ok();
  } catch (err) {
    // Roll back storage: the transaction (if it started) already rolled back.
    await Promise.all(
      uploadedKeys.map((p) => deleteFile("documents", p).catch(() => undefined)),
    );
    return failFromUnknown(err);
  }
}
