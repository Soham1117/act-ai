"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { uploadFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const submitSchema = z.object({
  title: z.string().min(2).max(100),
  category: z.enum([
    "TRAVEL", "MEALS", "OFFICE_SUPPLIES", "TRAINING", "EQUIPMENT",
    "MEDICAL", "FUEL", "ACCOMMODATION", "OTHER",
  ]),
  amount: z.coerce.number().min(0),
  currency: z.string().default("USD"),
  description: z.string().min(2).max(500),
  expenseDate: z.string(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});

export async function submitReimbursement(
  input: z.infer<typeof submitSchema>,
  receipts: { name: string; type: string; size: number; bytes: ArrayBuffer }[] = [],
): Promise<ActionResult<{ id: string; status: string }>> {
  const user = await requireUser();
  if (!user.employeeId) {
    return fail(
      "Your account has no employee profile yet. Ask an admin to create one before you can submit a reimbursement.",
    );
  }
  try {
    const data = submitSchema.parse(input);

    const uploaded = await Promise.all(
      receipts.slice(0, 5).map(async (f) => {
        const path = `${user.employeeId}/${Date.now()}-${f.name}`;
        const { key } = await uploadFile("reimbursement-receipts", path, f.bytes, {
          contentType: f.type,
        });
        return {
          fileName: path,
          originalName: f.name,
          fileUrl: key,
          fileSize: f.size,
          mimeType: f.type,
        };
      }),
    );

    const created = await db.$transaction(async (tx) => {
      const r = await tx.reimbursement.create({
        data: {
          employeeId: user.employeeId!,
          title: data.title,
          category: data.category,
          amount: data.amount,
          currency: data.currency,
          description: data.description,
          expenseDate: new Date(data.expenseDate),
          priority: data.priority,
          receipts: uploaded.length > 0 ? { create: uploaded } : undefined,
        },
      });
      await tx.reimbursementStatusHistory.create({
        data: {
          reimbursementId: r.id,
          status: "PENDING",
          note: "Submitted",
          updatedById: user.employeeId,
        },
      });
      return r;
    });
    revalidatePath("/dashboard/reimbursements");
    revalidatePath("/admin/reimbursements");
    return ok({ id: created.id, status: created.status });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const reviewSchema = z.object({
  reimbursementId: z.string(),
  status: z.enum(["UNDER_REVIEW", "APPROVED", "REJECTED", "PAID"]),
  note: z.string().optional(),
  paidAmount: z.coerce.number().optional(),
});

export async function reviewReimbursement(
  input: z.infer<typeof reviewSchema>,
): Promise<ActionResult<{ id: string; status: string }>> {
  const admin = await requireAdmin();
  try {
    const data = reviewSchema.parse(input);
    const r = await db.$transaction(async (tx) => {
      const updated = await tx.reimbursement.update({
        where: { id: data.reimbursementId },
        data: {
          status: data.status,
          reviewerId: admin.employeeId ?? undefined,
          reviewedAt: new Date(),
          reviewNotes: data.note ?? undefined,
          approvalDate: data.status === "APPROVED" ? new Date() : undefined,
          paidDate: data.status === "PAID" ? new Date() : undefined,
          paidAmount: data.status === "PAID" ? (data.paidAmount ?? undefined) : undefined,
        },
      });
      await tx.reimbursementStatusHistory.create({
        data: {
          reimbursementId: updated.id,
          status: data.status,
          note: data.note ?? null,
          updatedById: admin.employeeId ?? null,
        },
      });
      return updated;
    });
    await audit({
      action: `reimbursement.${data.status.toLowerCase()}`,
      resource: `Reimbursement:${data.reimbursementId}`,
      diff: { status: data.status, paidAmount: data.paidAmount },
    });
    revalidatePath("/admin/reimbursements");
    revalidatePath("/dashboard/reimbursements");
    return ok({ id: r.id, status: r.status });
  } catch (err) {
    return failFromUnknown(err);
  }
}
