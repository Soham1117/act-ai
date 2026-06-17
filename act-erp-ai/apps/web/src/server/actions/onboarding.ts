"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { uploadFile } from "@/lib/storage";
import { audit } from "@/lib/audit";

const INVITE_TTL_DAYS = 7;

/** Admin: create a new onboarding invite. Returns token + full URL. */
export async function createOnboardingInvite(input: { email?: string }) {
  const admin = await requireAdmin();
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
  return invite;
}

/** Admin: revoke (mark expired) an outstanding invite. */
export async function revokeOnboardingInvite(id: string) {
  await requireAdmin();
  await db.onboardingInvite.update({
    where: { id },
    data: { status: "EXPIRED", expiresAt: new Date(0) },
  });
  revalidatePath("/admin/onboarding");
}

const submitSchema = z.object({
  // Basic
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phoneNumber: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  maritalStatus: z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED", "OTHER"]).optional().nullable(),
  // Address
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zipCode: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  educationLevel: z.string().optional().nullable(),
  // Identity / emergency
  ssn: z.string().min(9).max(11),
  emergencyName: z.string().optional().nullable(),
  emergencyPhone: z.string().optional().nullable(),
  // Work
  employeeId: z.string().min(2).max(20).transform((v) => v.toUpperCase()),
  departmentId: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  dateOfHire: z.string().optional().nullable(),
  employmentType: z.enum(["FULL_PART_TIME", "CONTRACT_HOURLY"]),
  compensationType: z.enum(["MONTHLY_SALARY", "HOURLY_RATE", "TOTAL_COMPENSATION"]),
  compensationValue: z.coerce.number().optional().nullable(),
});

export type OnboardingSubmit = z.infer<typeof submitSchema>;

/**
 * Public: submit completed onboarding data with optional document files.
 *
 * Flow:
 *   1. Validate the invite token + load fields.
 *   2. Provision a Supabase auth user with the chosen password.
 *   3. Create User + Employee rows in a transaction.
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
) {
  const invite = await db.onboardingInvite.findUnique({ where: { token } });
  if (!invite) throw new Error("Invite not found");
  if (invite.status !== "PENDING") throw new Error("Invite already used");
  if (invite.expiresAt < new Date()) throw new Error("Invite expired");

  const data = submitSchema.parse(fields);

  // Provision Supabase auth user.
  const supabase = createServiceRoleClient();
  const { data: created, error: authErr } = await supabase.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { name: data.name },
  });
  if (authErr || !created.user) {
    throw new Error(authErr?.message ?? "Failed to create auth user");
  }
  const authId = created.user.id;

  // Create profile + employee.
  const employee = await db.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: authId,
        email: data.email,
        name: data.name,
        role: "EMPLOYEE",
      },
    });
    return tx.employee.create({
      data: {
        employeeId: data.employeeId,
        userId: authId,
        name: data.name,
        email: data.email,
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
        ssn: data.ssn,
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

  // Upload document files (best-effort; don't fail the whole submission if
  // individual uploads fail).
  for (const f of files) {
    try {
      const bytes = Buffer.from(f.base64, "base64");
      const path = `${employee.id}/${Date.now()}-${f.fileName.replace(/[^\w.-]/g, "_")}`;
      const { publicUrl } = await uploadFile("onboarding", path, bytes, {
        contentType: f.contentType,
      });
      await db.document.create({
        data: {
          title: f.title,
          fileName: f.fileName,
          fileType: f.contentType,
          fileUrl: publicUrl,
          documentType: f.documentType,
          employeeId: employee.id,
        },
      });
    } catch (err) {
      console.error("Onboarding document upload failed", f.fileName, err);
    }
  }

  // Mark invite completed.
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

  return { ok: true };
}
