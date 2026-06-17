"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

const schema = z.object({
  name: z.string().min(2),
  code: z.string().max(8).optional().nullable(),
  description: z.string().optional().nullable(),
});

export async function createDepartment(input: z.infer<typeof schema>) {
  await requireAdmin();
  const data = schema.parse(input);
  const dept = await db.department.create({ data });
  revalidatePath("/admin/departments");
  return dept;
}

export async function updateDepartment(
  id: string,
  input: z.infer<typeof schema>,
) {
  await requireAdmin();
  const data = schema.parse(input);
  const dept = await db.department.update({ where: { id }, data });
  revalidatePath("/admin/departments");
  revalidatePath(`/admin/departments/${id}`);
  return dept;
}

export async function deleteDepartment(id: string) {
  await requireAdmin();
  // Refuse if employees still assigned.
  const headcount = await db.employee.count({ where: { departmentId: id } });
  if (headcount > 0) {
    throw new Error(
      `Cannot delete: ${headcount} employee(s) still assigned to this department.`,
    );
  }
  await db.department.delete({ where: { id } });
  revalidatePath("/admin/departments");
}
