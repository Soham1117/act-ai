"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const schema = z.object({
  code: z.string().trim().min(2).max(20).transform((v) => v.toUpperCase()),
  title: z.string().trim().min(2).max(100),
  description: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => v?.trim() || null),
  rate: z.string().default("NA"),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  departmentId: z.string().optional().nullable(),
});

const GONE = "That job code no longer exists. Refresh the page and try again.";

export async function createJobCode(
  input: z.input<typeof schema>,
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
    await audit({
      action: "job_code.create",
      resource: `JobCode:${jc.id}`,
      diff: { code: data.code, title: data.title, isDefault: data.isDefault },
    });
    revalidatePath("/admin/job-codes");
    return ok({ id: jc.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function updateJobCode(
  id: string,
  input: z.input<typeof schema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = schema.parse(input);
    const before = await db.jobCode.findUnique({ where: { id } });
    if (!before) return fail(GONE);
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
    const changed = <T,>(a: T, b: T) => (a === b ? undefined : { from: a, to: b });
    await audit({
      action: "job_code.update",
      resource: `JobCode:${id}`,
      diff: {
        code: changed(before.code, data.code),
        title: changed(before.title, data.title),
        rate: changed(before.rate, data.rate),
        isActive: changed(before.isActive, data.isActive),
        isDefault: changed(before.isDefault, data.isDefault),
      },
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
    if (!current) return fail(GONE);
    const updated = await db.jobCode.update({
      where: { id },
      data: { isActive: !current.isActive },
    });
    await audit({
      action: "job_code.toggle_active",
      resource: `JobCode:${id}`,
      diff: { code: updated.code, isActive: updated.isActive },
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
    const jc = await db.jobCode.findUnique({ where: { id }, select: { code: true } });
    if (!jc) return fail(GONE);
    const [assignments, primaries] = await Promise.all([
      db.jobCodeAssignment.count({ where: { jobCodeId: id } }),
      db.employee.count({ where: { primaryJobCodeId: id } }),
    ]);
    if (assignments > 0 || primaries > 0) {
      return fail(
        `Cannot delete: ${Math.max(assignments, primaries)} employee(s) are still assigned to this job code. Toggle it inactive instead, or unassign them first.`,
      );
    }
    await db.jobCode.delete({ where: { id } });
    await audit({ action: "job_code.delete", resource: `JobCode:${id}`, diff: { code: jc.code } });
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
    const [jc, emp] = await Promise.all([
      db.jobCode.findUnique({ where: { id: jobCodeId }, select: { code: true } }),
      db.employee.findUnique({ where: { id: employeeId }, select: { name: true } }),
    ]);
    if (!jc) return fail(GONE);
    if (!emp) return fail("That employee was not found. Refresh the page and try again.");

    // One transaction so the assignment flag and Employee.primaryJobCodeId
    // can never disagree, and only one assignment is primary per employee.
    const assignment = await db.$transaction(async (tx) => {
      const a = await tx.jobCodeAssignment.upsert({
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
        await tx.jobCodeAssignment.updateMany({
          where: { employeeId, NOT: { jobCodeId } },
          data: { isPrimary: false },
        });
        await tx.employee.update({
          where: { id: employeeId },
          data: { primaryJobCodeId: jobCodeId },
        });
      } else {
        await tx.employee.updateMany({
          where: { id: employeeId, primaryJobCodeId: jobCodeId },
          data: { primaryJobCodeId: null },
        });
      }
      return a;
    });
    await audit({
      action: "job_code.assign",
      resource: `Employee:${employeeId}`,
      diff: { jobCode: jc.code, isPrimary, assignedRate: assignedRate ?? "NA" },
    });
    revalidatePath(`/admin/employees/${employeeId}`);
    revalidatePath("/admin/job-codes");
    revalidatePath(`/admin/job-codes/${jobCodeId}`);
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
    await db.$transaction(async (tx) => {
      await tx.jobCodeAssignment.delete({
        where: { jobCodeId_employeeId: { jobCodeId, employeeId } },
      });
      await tx.employee.updateMany({
        where: { id: employeeId, primaryJobCodeId: jobCodeId },
        data: { primaryJobCodeId: null },
      });
    });
    await audit({
      action: "job_code.unassign",
      resource: `Employee:${employeeId}`,
      diff: { jobCodeId },
    });
    revalidatePath(`/admin/employees/${employeeId}`);
    revalidatePath("/admin/job-codes");
    revalidatePath(`/admin/job-codes/${jobCodeId}`);
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
