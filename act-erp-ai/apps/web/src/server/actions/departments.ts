"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

// Blank code/description must become null: `code` is unique, so two "" values
// would collide.
const blankToNull = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

const schema = z.object({
  name: z.string().trim().min(2),
  code: z
    .string()
    .max(8)
    .optional()
    .nullable()
    .transform((v) => blankToNull(v)?.toUpperCase() ?? null),
  description: z
    .string()
    .optional()
    .nullable()
    .transform((v) => blankToNull(v)),
});

export async function createDepartment(
  input: z.input<typeof schema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = schema.parse(input);
    const dept = await db.department.create({ data });
    await audit({
      action: "department.create",
      resource: `Department:${dept.id}`,
      diff: { name: data.name, code: data.code },
    });
    revalidatePath("/admin/departments");
    return ok({ id: dept.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function updateDepartment(
  id: string,
  input: z.input<typeof schema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = schema.parse(input);
    const before = await db.department.findUnique({ where: { id } });
    if (!before) return fail("That department no longer exists. Refresh the page.");
    const dept = await db.department.update({ where: { id }, data });
    await audit({
      action: "department.update",
      resource: `Department:${id}`,
      diff: {
        name: before.name === data.name ? undefined : { from: before.name, to: data.name },
        code: before.code === data.code ? undefined : { from: before.code, to: data.code },
        description: before.description === data.description ? undefined : "[changed]",
      },
    });
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
    const dept = await db.department.findUnique({ where: { id }, select: { name: true } });
    if (!dept) return fail("That department no longer exists. Refresh the page.");
    const headcount = await db.employee.count({ where: { departmentId: id } });
    if (headcount > 0) {
      return fail(
        `Cannot delete this department: ${headcount} employee(s) are still assigned. Reassign them first, then try again.`,
      );
    }
    const pendingInvites = await db.onboardingInvite.count({
      where: { departmentId: id, status: "PENDING", expiresAt: { gt: new Date() } },
    });
    if (pendingInvites > 0) {
      return fail(
        `Cannot delete this department: ${pendingInvites} open onboarding invite(s) use it. Revoke them first.`,
      );
    }
    await db.department.delete({ where: { id } });
    await audit({
      action: "department.delete",
      resource: `Department:${id}`,
      diff: { name: dept.name },
    });
    revalidatePath("/admin/departments");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
