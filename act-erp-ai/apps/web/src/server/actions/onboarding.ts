"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
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

const INVITE_TTL_DAYS = 7;
const MAX_DOCS = 12;
const MAX_TOTAL_DOC_BYTES = 40 * 1024 * 1024;

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
  compensationValue: z.coerce.number().min(0, "Pay can't be negative").optional().nullable(),
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
      if (!dept) return fail("That department no longer exists. Refresh and pick another.");
    }
    let dateOfHire: Date | null = null;
    if (data.dateOfHire) {
      const c = checkDateOfHire(data.dateOfHire);
      if (!c.ok) return fail(c.error);
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
      data: { status: "EXPIRED", expiresAt: new Date(0) },
    });
    if (res.count === 0) {
      return fail("This invite was already used or revoked. Refresh the page.");
    }
    await audit({ action: "onboarding.invite_revoke", resource: `OnboardingInvite:${id}` });
    revalidatePath("/admin/onboarding");
    return ok();
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
  maritalStatus?: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED" | "SEPARATED" | "OTHER" | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  nationality?: string | null;
  educationLevel?: string | null;
  ssnLast4: string;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
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
      return fail("This onboarding invite was not found. Ask your admin for a new invite link.");
    }
    if (rateLimited(`onboard:${token}`, 15, 15 * 60_000)) {
      return fail("Too many attempts. Wait a few minutes and try again.");
    }

    const invite = await db.onboardingInvite.findUnique({ where: { token } });
    if (!invite) {
      return fail(
        "This onboarding invite was not found. Ask your admin for a new invite link.",
      );
    }
    if (invite.status !== "PENDING") {
      return fail(
        "This onboarding invite was already used. Sign in if you already finished, or ask your admin for a new invite.",
      );
    }
    if (invite.expiresAt < new Date()) {
      return fail(
        "This onboarding invite has expired. Ask your admin to send a new invite link.",
      );
    }

    const parsed = submitSchema.safeParse(fields);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path.length ? `${first.path.join(".")}: ` : "";
      return fail(`Check your details. ${where}${first?.message ?? "Some fields are invalid."}`);
    }
    const data = parsed.data;

    let dateOfBirth: Date | null = null;
    if (data.dateOfBirth) {
      const c = checkDateOfBirth(data.dateOfBirth);
      if (!c.ok) return fail(c.error);
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
      );
    }
    if (data.email) {
      const e = await db.employee.findUnique({ where: { email: data.email }, select: { id: true } });
      if (e) return fail("That work email is already on an employee record. Use a different email.");
    }

    // ---- validate every file before touching storage -------------------------
    if (files.length > MAX_DOCS) return fail(`Upload at most ${MAX_DOCS} documents.`);
    const prepared: Array<{
      title: string;
      documentType: (typeof DOC_TYPES)[number];
      bytes: Buffer;
      v: Extract<ReturnType<typeof validateUpload>, { ok: true }>;
    }> = [];
    let total = 0;
    const problems: string[] = [];
    for (const f of files) {
      const label = f.title?.trim() || f.fileName;
      if (!DOC_TYPES.includes(f.documentType)) {
        problems.push(`${label}: unknown document type.`);
        continue;
      }
      const bytes = Buffer.from(f.base64 ?? "", "base64");
      total += bytes.byteLength;
      const v = validateUpload("document", { name: f.fileName ?? "", bytes });
      if (!v.ok) {
        problems.push(`${label}: ${v.error}`);
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
      problems.push(`Documents are too large in total (max ${MAX_TOTAL_DOC_BYTES / (1024 * 1024)} MB).`);
    }
    if (problems.length) {
      return fail(
        `Nothing was submitted. Fix these files and try again: ${problems.join(" ")}`,
      );
    }

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
          employeeId,
          userId: user.id,
          name: data.name,
          email: data.email ?? null,
          personalEmail: data.personalEmail ?? null,
          gender: data.gender,
          maritalStatus: data.maritalStatus ?? null,
          phoneNumber: data.phoneNumber || null,
          dateOfBirth,
          address: data.address || null,
          city: data.city || null,
          state: data.state || null,
          zipCode: data.zipCode || null,
          nationality: data.nationality || null,
          educationLevel: data.educationLevel || null,
          ssnLast4: data.ssnLast4,
          emergencyName: data.emergencyName || null,
          emergencyPhone: data.emergencyPhone || null,
          // Admin-decided terms from the invite:
          departmentId: deptId,
          jobTitle: invite.jobTitle,
          dateOfHire: invite.dateOfHire,
          employmentType: invite.employmentType ?? "FULL_PART_TIME",
          compensationType: invite.compensationType ?? "HOURLY_RATE",
          compensationValue: invite.compensationValue,
          employmentStatus: "PENDING_REVIEW",
          kioskPinHash,
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
      await tx.onboardingInvite.update({
        where: { id: invite.id },
        data: { completedByEmployeeId: emp.id },
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
