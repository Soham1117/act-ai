"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { uploadFile } from "@/lib/storage";

const employeeSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  ssn: z.string().min(9).max(11),
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

  // Provision the Supabase auth user with the service-role client.
  const admin = createServiceRoleClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { name: data.name },
  });
  if (error || !created.user) {
    throw new Error(error?.message ?? "Failed to create auth user");
  }

  // Auto-generate EMP-YYYY-NNNN.
  const year = new Date().getFullYear();
  const count = await db.employee.count({
    where: { employeeId: { startsWith: `EMP-${year}-` } },
  });
  const employeeId = `EMP-${year}-${String(count + 1).padStart(4, "0")}`;

  const employee = await db.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: created.user.id,
        email: data.email,
        name: data.name,
        role: "EMPLOYEE",
      },
    });
    return tx.employee.create({
      data: {
        employeeId,
        userId: created.user.id,
        name: data.name,
        email: data.email,
        ssn: data.ssn,
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
  return employee;
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
  return updated;
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
  const admin = createServiceRoleClient();
  const { error } = await admin.auth.admin.updateUserById(employee.userId, { password });
  if (error) throw new Error(error.message);
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
  return updated;
}

export async function updateEmployeeProfilePic(
  employeeId: string,
  file: { name: string; type: string; bytes: ArrayBuffer },
) {
  await requireAdmin();
  const path = `${employeeId}/${Date.now()}-${file.name}`;
  const { publicUrl } = await uploadFile("profile-pics", path, file.bytes, {
    contentType: file.type,
    upsert: true,
  });
  await db.employee.update({
    where: { id: employeeId },
    data: { profilePic: publicUrl },
  });
  await audit({
    action: "employee.profile_pic_update",
    resource: `Employee:${employeeId}`,
  });
  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/admin/employees");
  return { url: publicUrl };
}

export async function bulkDeleteEmployees(ids: string[]) {
  await requireAdmin();
  if (ids.length === 0) return 0;
  const employees = await db.employee.findMany({
    where: { id: { in: ids } },
    select: { userId: true },
  });
  const admin = createServiceRoleClient();
  await Promise.all(
    employees.map((e) => admin.auth.admin.deleteUser(e.userId).catch(() => null)),
  );
  const { count } = await db.employee.deleteMany({ where: { id: { in: ids } } });
  revalidatePath("/admin/employees");
  return count;
}
