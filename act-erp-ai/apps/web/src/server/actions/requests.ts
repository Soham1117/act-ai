"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const submitSchema = z.object({
  type: z.enum([
    "DOCUMENT_REQUEST", "DETAILS_CHANGE", "LEAVE_REQUEST", "PAYROLL_INQUIRY",
    "SCHEDULE_CHANGE", "ACCESS_REQUEST", "TRAINING_REQUEST", "EQUIPMENT_REQUEST",
    "LOCATION_CHANGE", "TEAM_REQUEST", "PROJECT_REQUEST", "BENEFITS_INQUIRY", "OTHER",
  ]),
  title: z.string().min(2).max(120),
  description: z.string().min(2),
});

export async function submitRequest(
  input: z.infer<typeof submitSchema>,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  if (!user.employeeId) {
    return fail(
      "Your account has no employee profile yet. Ask an admin to create one before you can submit a request.",
    );
  }
  try {
    const data = submitSchema.parse(input);

    const created = await db.$transaction(async (tx) => {
      const r = await tx.request.create({
        data: {
          employeeId: user.employeeId!,
          type: data.type,
          title: data.title,
          description: data.description,
        },
      });
      await tx.requestStatusHistory.create({
        data: {
          requestId: r.id,
          status: "PENDING",
          note: "Submitted by employee",
          updatedById: user.employeeId,
        },
      });
      return r;
    });
    revalidatePath("/dashboard/requests");
    revalidatePath("/admin/requests");
    return ok({ id: created.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const updateStatusSchema = z.object({
  requestId: z.string(),
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "REJECTED"]),
  note: z.string().optional(),
});

export async function updateRequestStatus(
  input: z.infer<typeof updateStatusSchema>,
): Promise<ActionResult<{ id: string; status: string }>> {
  const admin = await requireAdmin();
  try {
    const data = updateStatusSchema.parse(input);
    const r = await db.$transaction(async (tx) => {
      const updated = await tx.request.update({
        where: { id: data.requestId },
        data: {
          status: data.status,
          adminNotes: data.note ?? undefined,
          reviewerId: admin.employeeId ?? undefined,
        },
      });
      await tx.requestStatusHistory.create({
        data: {
          requestId: updated.id,
          status: data.status,
          note: data.note ?? null,
          updatedById: admin.employeeId ?? null,
        },
      });
      return updated;
    });
    revalidatePath("/admin/requests");
    revalidatePath("/dashboard/requests");
    return ok({ id: r.id, status: r.status });
  } catch (err) {
    return failFromUnknown(err);
  }
}
