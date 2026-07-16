"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { uploadFile } from "@/lib/storage";
import { audit } from "@/lib/audit";

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
) {
  const user = await requireUser();
  if (!user.employeeId) throw new Error("No employee record");
  const data = submitSchema.parse(input);

  // Upload receipts first so we can fail fast if storage rejects.
  const uploaded = await Promise.all(
    receipts.slice(0, 5).map(async (f) => {
      const path = `${user.employeeId}/${Date.now()}-${f.name}`;
      const { publicUrl } = await uploadFile("reimbursement-receipts", path, f.bytes, {
        contentType: f.type,
      });
      return {
        fileName: path,
        originalName: f.name,
        fileUrl: publicUrl,
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
  // Plain object only — Reimbursement rows carry Decimals (amount, paidAmount)
  // that can't cross the server-action boundary to client components.
  return { id: created.id, status: created.status };
}

const reviewSchema = z.object({
  reimbursementId: z.string(),
  status: z.enum(["UNDER_REVIEW", "APPROVED", "REJECTED", "PAID"]),
  note: z.string().optional(),
  paidAmount: z.coerce.number().optional(),
});

export async function reviewReimbursement(input: z.infer<typeof reviewSchema>) {
  const admin = await requireAdmin();
  const data = reviewSchema.parse(input);
  return db.$transaction(async (tx) => {
    const r = await tx.reimbursement.update({
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
        reimbursementId: r.id,
        status: data.status,
        note: data.note ?? null,
        updatedById: admin.employeeId ?? null,
      },
    });
    revalidatePath("/admin/reimbursements");
    revalidatePath("/dashboard/reimbursements");
    return r;
  }).then(async (r) => {
    await audit({
      action: `reimbursement.${data.status.toLowerCase()}`,
      resource: `Reimbursement:${data.reimbursementId}`,
      diff: { status: data.status, paidAmount: data.paidAmount },
    });
    return { id: r.id, status: r.status };
  });
}
