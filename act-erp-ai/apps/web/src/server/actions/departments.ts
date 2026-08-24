"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const schema = z.object({
  name: z.string().min(2),
  code: z.string().max(8).optional().nullable(),
  description: z.string().optional().nullable(),
});

export async function createDepartment(
  input: z.infer<typeof schema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = schema.parse(input);
    const dept = await db.department.create({ data });
    revalidatePath("/admin/departments");
    return ok({ id: dept.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function updateDepartment(
  id: string,
  input: z.infer<typeof schema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = schema.parse(input);
    const dept = await db.department.update({ where: { id }, data });
    revalidatePath("/admin/departments");
    revalidatePath(`/admin/departments/${id}`);
    return ok({ id: dept.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function deleteDepartment(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const headcount = await db.employee.count({ where: { departmentId: id } });
    if (headcount > 0) {
      return fail(
        `Cannot delete this department: ${headcount} employee(s) are still assigned. Reassign them first, then try again.`,
      );
    }
    await db.department.delete({ where: { id } });
    revalidatePath("/admin/departments");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
