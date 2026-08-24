"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";
import { uploadFile } from "@/lib/storage";

const employeeSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  // Only for employees with no company email — they log in with this instead.
  username: z.string().regex(/^[a-z0-9._-]{3,32}$/).optional(),
  // Where 2FA sign-in codes go — deliberately separate from the login email
  // above, since some employees have no company email at all.
  personalEmail: z.string().email(),
  // Last 4 digits only — we deliberately never collect the full SSN.
  ssnLast4: z.string().regex(/^\d{4}$/, "Enter the last 4 digits of the SSN").optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  departmentId: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  employmentType: z.enum(["FULL_PART_TIME", "CONTRACT_HOURLY"]),
  compensationType: z.enum(["MONTHLY_SALARY", "HOURLY_RATE", "TOTAL_COMPENSATION"]),
  compensationValue: z.coerce.number().optional().nullable(),
  password: z.string().min(8),
});

export async function createEmployee(input: z.infer<typeof employeeSchema>) {
  await requireAdmin();
  const data = employeeSchema.parse(input);

  const passwordHash = await hashPassword(data.password);

  // Auto-generate EMP-YYYY-NNNN.
  const year = new Date().getFullYear();
  const count = await db.employee.count({
    where: { employeeId: { startsWith: `EMP-${year}-` } },
  });
  const employeeId = `EMP-${year}-${String(count + 1).padStart(4, "0")}`;

  const employee = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        username: data.username ?? null,
        name: data.name,
        role: "EMPLOYEE",
        passwordHash,
      },
    });
    return tx.employee.create({
      data: {
        employeeId,
        userId: user.id,
        name: data.name,
        email: data.email,
        personalEmail: data.personalEmail,
        ssnLast4: data.ssnLast4 ?? null,
        gender: data.gender,
        departmentId: data.departmentId || null,
        jobTitle: data.jobTitle || null,
        phoneNumber: data.phoneNumber || null,
        employmentType: data.employmentType,
        compensationType: data.compensationType,
        compensationValue: data.compensationValue ?? null,
      },
    });
  });

  await audit({ action: "employee.create", resource: `Employee:${employee.id}`, diff: { employeeId, email: data.email } });
  revalidatePath("/admin/employees");
  // Plain object only — Employee rows carry Decimals (compensationValue,
  // defaultHourlyRate) that can't cross the server-action boundary.
  return { id: employee.id };
}

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  maritalStatus: z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED", "OTHER"]).optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  // Personal
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zipCode: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  educationLevel: z.string().optional().nullable(),
  emergencyName: z.string().optional().nullable(),
  emergencyPhone: z.string().optional().nullable(),
  // Work
  departmentId: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  jobDescription: z.string().optional().nullable(),
  dateOfHire: z.string().optional().nullable(),
  supervisorId: z.string().optional().nullable(),
  employmentType: z.enum(["FULL_PART_TIME", "CONTRACT_HOURLY"]).optional(),
  workEmail: z.string().optional().nullable(),
  workPhoneNumber: z.string().optional().nullable(),
  // Compensation
  compensationType: z.enum(["MONTHLY_SALARY", "HOURLY_RATE", "TOTAL_COMPENSATION"]).optional(),
  compensationValue: z.coerce.number().optional().nullable(),
  defaultHourlyRate: z.coerce.number().optional(),
  primaryJobCodeId: z.string().optional().nullable(),
});

export async function updateEmployee(
  employeeId: string,
  input: z.infer<typeof updateSchema>,
) {
  await requireAdmin();
  const parsed = updateSchema.parse(input);
  const data: Record<string, unknown> = { ...parsed };
  // Coerce date strings to Date.
  if (typeof parsed.dateOfBirth === "string" && parsed.dateOfBirth) {
    data.dateOfBirth = new Date(parsed.dateOfBirth);
  } else if (parsed.dateOfBirth === "") {
    data.dateOfBirth = null;
  }
  if (typeof parsed.dateOfHire === "string" && parsed.dateOfHire) {
    data.dateOfHire = new Date(parsed.dateOfHire);
  } else if (parsed.dateOfHire === "") {
    data.dateOfHire = null;
  }
  const updated = await db.employee.update({
    where: { id: employeeId },
    data,
  });
  await audit({ action: "employee.update", resource: `Employee:${employeeId}`, diff: data });
  revalidatePath("/admin/employees");
  revalidatePath(`/admin/employees/${employeeId}`);
  return { id: updated.id };
}

const passwordSchema = z.object({
  password: z.string().min(8, "Min 8 characters"),
});

export async function changeEmployeePassword(
  employeeId: string,
  input: z.infer<typeof passwordSchema>,
) {
  await requireAdmin();
  const { password } = passwordSchema.parse(input);
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true, name: true },
  });
  if (!employee) throw new Error("Employee not found");
  // Set the new hash and revoke existing sessions (bump tokenVersion).
  await db.user.update({
    where: { id: employee.userId },
    data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 } },
  });
  await audit({
    action: "employee.password_change",
    resource: `Employee:${employeeId}`,
    diff: { name: employee.name },
  });
  return { ok: true };
}

export async function setEmploymentStatus(
  employeeId: string,
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED",
  reason?: string,
) {
  await requireAdmin();
  const updated = await db.employee.update({
    where: { id: employeeId },
    data: {
      employmentStatus: status,
      terminationDate: status === "TERMINATED" ? new Date() : null,
      terminationReason: status === "TERMINATED" ? (reason ?? null) : null,
    },
  });
  revalidatePath("/admin/employees");
  revalidatePath(`/admin/employees/${employeeId}`);
  return { id: updated.id };
}

export async function updateEmployeeProfilePic(
  employeeId: string,
  file: { name: string; type: string; bytes: ArrayBuffer },
) {
  await requireAdmin();
  // Fixed key per employee (not timestamped) — the proxy route derives the
  // object key from employeeId alone, and each upload overwrites the last.
  const path = `${employeeId}/avatar`;
  await uploadFile("profile-pics", path, file.bytes, {
    contentType: file.type,
    upsert: true,
  });
  // Store the proxy path, not a presigned S3 URL — it never expires and every
  // read re-checks the caller is authenticated (see /api/employees/[id]/profile-pic).
  const url = `/api/employees/${employeeId}/profile-pic`;
  await db.employee.update({
    where: { id: employeeId },
    data: { profilePic: url },
  });
  await audit({
    action: "employee.profile_pic_update",
    resource: `Employee:${employeeId}`,
  });
  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/admin/employees");
  return { url };
}

/** Self-service: update the personal email 2FA codes are sent to. Requires
 *  the current password, same as changing it — this controls login access. */
export async function updateMyPersonalEmail(
  currentPassword: string,
  personalEmail: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!user.employeeId) return { ok: false, error: "No employee record" };
  const parsed = z.string().email().safeParse(personalEmail);
  if (!parsed.success) return { ok: false, error: "Enter a valid email" };

  const row = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!row?.passwordHash || !(await verifyPassword(currentPassword, row.passwordHash))) {
    return { ok: false, error: "Current password is incorrect" };
  }
  await db.employee.update({
    where: { id: user.employeeId },
    data: { personalEmail: parsed.data },
  });
  await audit({ action: "employee.personal_email_update", resource: `Employee:${user.employeeId}` });
  return { ok: true };
}

/**
 * IRS Treas. Reg. 31.6051-1 electronic W-2 consent — self-service.
 * `consentToElectronicW2` is the affirmative, electronically-confirmed
 * consent the regulation requires (the timestamp itself is the record).
 * `withdrawW2Consent` reverts to paper-only; per the regulation this takes
 * effect immediately and doesn't require a password (withdrawing consent
 * should never be harder than giving it).
 */
export async function consentToElectronicW2(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!user.employeeId) return { ok: false, error: "No employee record" };
  await db.employee.update({
    where: { id: user.employeeId },
    data: { w2ConsentAt: new Date() },
  });
  await audit({ action: "employee.w2_consent_given", resource: `Employee:${user.employeeId}` });
  return { ok: true };
}

export async function withdrawW2Consent(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!user.employeeId) return { ok: false, error: "No employee record" };
  await db.employee.update({
    where: { id: user.employeeId },
    data: { w2ConsentAt: null },
  });
  await audit({ action: "employee.w2_consent_withdrawn", resource: `Employee:${user.employeeId}` });
  return { ok: true };
}

/**
 * 29 CFR 2520.104b-1(c) electronic delivery consent for health & welfare
 * plan documents (SPDs/SMMs/SBCs) — see the `///` comment on
 * `Employee.benefitsEConsentAt` for why this is scoped to health & welfare
 * only, not the separate 401(k) notice-and-access safe harbor. Same pattern
 * as the W-2 pair above: withdrawal never requires a password, because
 * withdrawing consent must never be harder than giving it.
 */
export async function consentToBenefitsEDelivery(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!user.employeeId) return { ok: false, error: "No employee record" };
  await db.employee.update({
    where: { id: user.employeeId },
    data: { benefitsEConsentAt: new Date() },
  });
  await audit({ action: "employee.benefits_econsent_given", resource: `Employee:${user.employeeId}` });
  return { ok: true };
}

export async function withdrawBenefitsEConsent(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!user.employeeId) return { ok: false, error: "No employee record" };
  await db.employee.update({
    where: { id: user.employeeId },
    data: { benefitsEConsentAt: null },
  });
  await audit({ action: "employee.benefits_econsent_withdrawn", resource: `Employee:${user.employeeId}` });
  return { ok: true };
}

export async function bulkDeleteEmployees(ids: string[]) {
  await requireAdmin();
  if (ids.length === 0) return 0;
  const employees = await db.employee.findMany({
    where: { id: { in: ids } },
    select: { userId: true },
  });
  const userIds = employees.map((e) => e.userId);
  const { count } = await db.employee.deleteMany({ where: { id: { in: ids } } });
  // Disable login for the removed users (null the hash + revoke sessions). We keep
  // the User row so audit logs / uploaded-doc provenance stay intact.
  await db.user.updateMany({
    where: { id: { in: userIds } },
    data: { passwordHash: null, tokenVersion: { increment: 1 } },
  });
  revalidatePath("/admin/employees");
  return count;
}
