"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const schema = z.object({
  code: z.string().min(2).max(20).transform((v) => v.toUpperCase()),
  title: z.string().min(2).max(100),
  description: z.string().max(500).optional().nullable(),
  rate: z.string().default("NA"),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  departmentId: z.string().optional().nullable(),
});

export async function createJobCode(
  input: z.infer<typeof schema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = schema.parse(input);
    const jc = await db.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.jobCode.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.jobCode.create({
        data: { ...data, departmentId: data.departmentId || null },
      });
    });
    revalidatePath("/admin/job-codes");
    return ok({ id: jc.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function updateJobCode(
  id: string,
  input: z.infer<typeof schema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = schema.parse(input);
    const jc = await db.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.jobCode.updateMany({
          where: { isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.jobCode.update({
        where: { id },
        data: { ...data, departmentId: data.departmentId || null },
      });
    });
    revalidatePath("/admin/job-codes");
    revalidatePath(`/admin/job-codes/${id}`);
    return ok({ id: jc.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function toggleJobCodeActive(
  id: string,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  await requireAdmin();
  try {
    const current = await db.jobCode.findUnique({ where: { id } });
    if (!current) {
      return fail("That job code no longer exists. Refresh the page and try again.");
    }
    const updated = await db.jobCode.update({
      where: { id },
      data: { isActive: !current.isActive },
    });
    revalidatePath("/admin/job-codes");
    return ok({ id: updated.id, isActive: updated.isActive });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function deleteJobCode(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const assignments = await db.jobCodeAssignment.count({ where: { jobCodeId: id } });
    if (assignments > 0) {
      return fail(
        `Cannot delete: ${assignments} employee(s) are still assigned to this job code. Toggle it inactive instead, or unassign them first.`,
      );
    }
    await db.jobCode.delete({ where: { id } });
    revalidatePath("/admin/job-codes");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function assignJobCode(
  jobCodeId: string,
  employeeId: string,
  isPrimary = false,
  assignedRate?: string,
  notes?: string,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
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
    return ok({ id: assignment.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function unassignJobCode(
  jobCodeId: string,
  employeeId: string,
): Promise<ActionResult> {
  await requireAdmin();
  try {
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
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
