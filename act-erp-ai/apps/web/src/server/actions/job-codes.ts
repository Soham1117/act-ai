"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

const schema = z.object({
  code: z.string().min(2).max(20).transform((v) => v.toUpperCase()),
  title: z.string().min(2).max(100),
  description: z.string().max(500).optional().nullable(),
  rate: z.string().default("NA"),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  departmentId: z.string().optional().nullable(),
});

export async function createJobCode(input: z.infer<typeof schema>) {
  await requireAdmin();
  const data = schema.parse(input);
  return db.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.jobCode.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    const jc = await tx.jobCode.create({
      data: { ...data, departmentId: data.departmentId || null },
    });
    revalidatePath("/admin/job-codes");
    return jc;
  });
}

export async function updateJobCode(id: string, input: z.infer<typeof schema>) {
  await requireAdmin();
  const data = schema.parse(input);
  return db.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.jobCode.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    const jc = await tx.jobCode.update({
      where: { id },
      data: { ...data, departmentId: data.departmentId || null },
    });
    revalidatePath("/admin/job-codes");
    revalidatePath(`/admin/job-codes/${id}`);
    return jc;
  });
}

export async function toggleJobCodeActive(id: string) {
  await requireAdmin();
  const current = await db.jobCode.findUnique({ where: { id } });
  if (!current) throw new Error("Not found");
  const updated = await db.jobCode.update({
    where: { id },
    data: { isActive: !current.isActive },
  });
  revalidatePath("/admin/job-codes");
  return updated;
}

export async function deleteJobCode(id: string) {
  await requireAdmin();
  const assignments = await db.jobCodeAssignment.count({ where: { jobCodeId: id } });
  if (assignments > 0) {
    throw new Error(
      `Cannot delete: ${assignments} employee(s) still assigned. Toggle inactive instead.`,
    );
  }
  await db.jobCode.delete({ where: { id } });
  revalidatePath("/admin/job-codes");
}

export async function assignJobCode(
  jobCodeId: string,
  employeeId: string,
  isPrimary = false,
  assignedRate?: string,
  notes?: string,
) {
  await requireAdmin();
  const assignment = await db.jobCodeAssignment.upsert({
    where: { jobCodeId_employeeId: { jobCodeId, employeeId } },
    create: {
      jobCodeId,
      employeeId,
      isPrimary,
      assignedRate: assignedRate ?? "NA",
      notes: notes ?? null,
    },
    update: {
      isPrimary,
      assignedRate: assignedRate ?? "NA",
      notes: notes ?? null,
    },
  });
  if (isPrimary) {
    await db.employee.update({
      where: { id: employeeId },
      data: { primaryJobCodeId: jobCodeId },
    });
  }
  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/admin/job-codes");
  return assignment;
}

export async function unassignJobCode(jobCodeId: string, employeeId: string) {
  await requireAdmin();
  await db.jobCodeAssignment.delete({
    where: { jobCodeId_employeeId: { jobCodeId, employeeId } },
  });
  await db.employee.updateMany({
    where: { id: employeeId, primaryJobCodeId: jobCodeId },
    data: { primaryJobCodeId: null },
  });
  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/admin/job-codes");
  revalidatePath(`/admin/job-codes/${jobCodeId}`);
}
