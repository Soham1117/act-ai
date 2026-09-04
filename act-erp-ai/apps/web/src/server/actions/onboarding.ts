"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { hashPassword } from "@/lib/auth/password";
import { uploadFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const INVITE_TTL_DAYS = 7;

/** Admin: create a new onboarding invite. Returns token + full URL. */
export async function createOnboardingInvite(input: {
  email?: string;
}): Promise<ActionResult<{ id: string; token: string }>> {
  const admin = await requireAdmin();
  try {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const invite = await db.onboardingInvite.create({
      data: {
        token,
        email: input.email || null,
        expiresAt,
        createdById: admin.id,
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
    await db.onboardingInvite.update({
      where: { id },
      data: { status: "EXPIRED", expiresAt: new Date(0) },
    });
    revalidatePath("/admin/onboarding");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

const submitSchema = z
  .object({
    // Basic
    name: z.string().min(2),
    // Optional — some hires (part-time / shop floor) have no company email at
    // all. If omitted, `username` is required instead as the login identifier.
    email: z
      .string()
      .email()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    username: z
      .string()
      .regex(/^[a-z0-9._-]{3,32}$/, "Lowercase letters, numbers, . _ - only, 3-32 chars")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    // Optional while password-only login is enabled. Retained so 2FA can be
    // restored later without changing the onboarding data model again.
    personalEmail: z
      .string()
      .email()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    password: z.string().min(8),
    phoneNumber: z.string().optional().nullable(),
    dateOfBirth: z.string().optional().nullable(),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
    maritalStatus: z
      .enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED", "OTHER"])
      .optional()
      .nullable(),
    // Address
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    zipCode: z.string().optional().nullable(),
    nationality: z.string().optional().nullable(),
    educationLevel: z.string().optional().nullable(),
    // Identity / emergency
    // Last 4 digits only — we deliberately never collect the full SSN.
    ssnLast4: z.string().regex(/^\d{4}$/, "Enter the last 4 digits of your SSN"),
    emergencyName: z.string().optional().nullable(),
    emergencyPhone: z.string().optional().nullable(),
    // Work
    employeeId: z
      .string()
      .min(2)
      .max(20)
      .transform((v) => v.toUpperCase()),
    departmentId: z.string().optional().nullable(),
    jobTitle: z.string().optional().nullable(),
    position: z.string().optional().nullable(),
    dateOfHire: z.string().optional().nullable(),
    employmentType: z.enum(["FULL_PART_TIME", "CONTRACT_HOURLY"]),
    compensationType: z.enum(["MONTHLY_SALARY", "HOURLY_RATE", "TOTAL_COMPENSATION"]),
    compensationValue: z.coerce.number().optional().nullable(),
  })
  .refine((v) => v.email || v.username, {
    message: "Provide either a work email or a username",
    path: ["username"],
  });

export type OnboardingSubmit = z.infer<typeof submitSchema>;

/**
 * Public: submit completed onboarding data with optional document files.
 *
 * Flow:
 *   1. Validate the invite token + load fields.
 *   2. Create User (credentials, hashed password) + Employee rows in a transaction.
 *   4. Upload each document file to the `onboarding` bucket and create
 *      Document rows referencing them.
 *   5. Mark the invite COMPLETED.
 */
export async function submitOnboarding(
  token: string,
  fields: OnboardingSubmit,
  files: Array<{
    fileName: string;
    title: string;
    documentType: "PERSONAL" | "ONBOARDING" | "BENEFITS" | "TRAINING";
    contentType: string;
    /** Base64-encoded file bytes (the form encodes via FileReader). */
    base64: string;
  }>,
): Promise<ActionResult> {
  try {
    const invite = await db.onboardingInvite.findUnique({ where: { token } });
    if (!invite) {
      return fail(
        "This onboarding invite was not found. Ask your admin for a new invite link.",
      );
    }
    if (invite.status !== "PENDING") {
      return fail(
        "This onboarding invite was already used. Ask your admin for a new invite if you need to continue.",
      );
    }
    if (invite.expiresAt < new Date()) {
      return fail(
        "This onboarding invite has expired. Ask your admin to send a new invite link.",
      );
    }

    const data = submitSchema.parse(fields);

    const passwordHash = await hashPassword(data.password);

    const employee = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email ?? null,
          username: data.username ?? null,
          name: data.name,
          role: "EMPLOYEE",
          passwordHash,
        },
      });
      return tx.employee.create({
        data: {
          employeeId: data.employeeId,
          userId: user.id,
          name: data.name,
          email: data.email ?? null,
          personalEmail: data.personalEmail ?? null,
          gender: data.gender,
          maritalStatus: data.maritalStatus ?? null,
          phoneNumber: data.phoneNumber ?? null,
          dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
          address: data.address ?? null,
          city: data.city ?? null,
          state: data.state ?? null,
          zipCode: data.zipCode ?? null,
          nationality: data.nationality ?? null,
          educationLevel: data.educationLevel ?? null,
          ssnLast4: data.ssnLast4,
          emergencyName: data.emergencyName ?? null,
          emergencyPhone: data.emergencyPhone ?? null,
          departmentId: data.departmentId || null,
          jobTitle: data.jobTitle ?? null,
          position: data.position ?? null,
          dateOfHire: data.dateOfHire ? new Date(data.dateOfHire) : null,
          employmentType: data.employmentType,
          employmentStatus: "ACTIVE",
          compensationType: data.compensationType,
          compensationValue: data.compensationValue ?? null,
        },
      });
    });

    for (const f of files) {
      try {
        const bytes = Buffer.from(f.base64, "base64");
        const path = `${employee.id}/${Date.now()}-${f.fileName.replace(/[^\w.-]/g, "_")}`;
        const { key } = await uploadFile("documents", path, bytes, {
          contentType: f.contentType,
        });
        await db.document.create({
          data: {
            title: f.title,
            fileName: path,
            fileType: f.contentType,
            fileUrl: key,
            documentType: f.documentType,
            employeeId: employee.id,
          },
        });
      } catch (err) {
        console.error("Onboarding document upload failed", f.fileName, err);
      }
    }

    await db.onboardingInvite.update({
      where: { id: invite.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completedByEmployeeId: employee.id,
      },
    });

    await audit({
      action: "onboarding.complete",
      resource: `Employee:${employee.id}`,
      diff: { employeeId: data.employeeId, email: data.email },
    });

    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
