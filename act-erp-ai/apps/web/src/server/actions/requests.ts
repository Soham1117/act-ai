"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";

const submitSchema = z.object({
  type: z.enum([
    "DOCUMENT_REQUEST", "DETAILS_CHANGE", "LEAVE_REQUEST", "PAYROLL_INQUIRY",
    "SCHEDULE_CHANGE", "ACCESS_REQUEST", "TRAINING_REQUEST", "EQUIPMENT_REQUEST",
    "LOCATION_CHANGE", "TEAM_REQUEST", "PROJECT_REQUEST", "BENEFITS_INQUIRY", "OTHER",
  ]),
  title: z.string().min(2).max(120),
  description: z.string().min(2),
});

export async function submitRequest(input: z.infer<typeof submitSchema>) {
  const user = await requireUser();
  if (!user.employeeId) throw new Error("No employee record");
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
  return created;
}

const updateStatusSchema = z.object({
  requestId: z.string(),
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "REJECTED"]),
  note: z.string().optional(),
});

export async function updateRequestStatus(input: z.infer<typeof updateStatusSchema>) {
  const admin = await requireAdmin();
  const data = updateStatusSchema.parse(input);
  return db.$transaction(async (tx) => {
    const r = await tx.request.update({
      where: { id: data.requestId },
      data: {
        status: data.status,
        adminNotes: data.note ?? undefined,
        reviewerId: admin.employeeId ?? undefined,
      },
    });
    await tx.requestStatusHistory.create({
      data: {
        requestId: r.id,
        status: data.status,
        note: data.note ?? null,
        updatedById: admin.employeeId ?? null,
      },
    });
    revalidatePath("/admin/requests");
    revalidatePath("/dashboard/requests");
    return r;
  });
}
