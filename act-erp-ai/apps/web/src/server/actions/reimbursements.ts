"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, requireWritableUser, ReadOnlyAccountError } from "@/lib/auth";
import { READ_ONLY_MESSAGE } from "@/lib/access";
import { uploadFile, deleteFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { validateUpload } from "@/lib/upload-validation";
import { notifyAdmins, notifyEmployees } from "@/lib/notify";
import { businessDateOnly, formatCurrency } from "@/lib/format";
import {
  MAX_RECEIPTS,
  canReopen,
  canTransition,
  validateClaimAmount,
  validatePaidAmount,
  type ReimbursementStatus,
} from "@/lib/reimbursement";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const submitSchema = z.object({
  title: z.string().trim().min(2).max(100),
  category: z.enum([
    "TRAVEL", "MEALS", "OFFICE_SUPPLIES", "TRAINING", "EQUIPMENT",
    "MEDICAL", "FUEL", "ACCOMMODATION", "OTHER",
  ]),
  amount: z.coerce.number(),
  currency: z.string().length(3).default("USD"),
  description: z.string().trim().min(2).max(500),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid expense date"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});

function revalidateAll() {
  revalidatePath("/dashboard/reimbursements");
  revalidatePath("/admin/reimbursements");
}

export async function submitReimbursement(
  input: z.input<typeof submitSchema>,
  receipts: { name: string; type: string; size: number; bytes: ArrayBuffer }[] = [],
): Promise<ActionResult<{ id: string; status: string }>> {
  const uploadedKeys: string[] = [];
  try {
    const user = await requireWritableUser();
    if (!user.employeeId) {
      return fail(
        "Your account has no employee profile yet. Ask an admin to create one before you can submit a reimbursement.",
      );
    }
    const data = submitSchema.parse(input);

    const amountCheck = validateClaimAmount(data.amount);
    if (!amountCheck.ok) return fail(amountCheck.error);

    const expenseDate = new Date(`${data.expenseDate}T00:00:00.000Z`);
    if (Number.isNaN(expenseDate.getTime())) return fail("Enter a valid expense date.");
    if (expenseDate > businessDateOnly()) return fail("The expense date can't be in the future.");

    if (receipts.length > MAX_RECEIPTS) {
      return fail(`Attach at most ${MAX_RECEIPTS} receipts per claim.`);
    }
    const validated: Array<{
      name: string;
      bytes: ArrayBuffer;
      v: Extract<ReturnType<typeof validateUpload>, { ok: true }>;
    }> = [];
    for (const f of receipts) {
      const v = validateUpload("receipt", { name: f.name, bytes: f.bytes });
      if (!v.ok) return fail(`${f.name}: ${v.error}`);
      validated.push({ name: f.name, bytes: f.bytes, v });
    }

    const uploaded: {
      fileName: string;
      originalName: string;
      fileUrl: string;
      fileSize: number;
      mimeType: string;
    }[] = [];
    let i = 0;
    for (const f of validated) {
      const path = `${user.employeeId}/${Date.now()}-${i++}-${f.v.safeFileName}`;
      const { key } = await uploadFile("reimbursement-receipts", path, f.bytes, {
        contentType: f.v.contentType,
      });
      uploadedKeys.push(path);
      uploaded.push({
        fileName: path,
        originalName: f.v.safeFileName,
        fileUrl: key,
        fileSize: f.v.size,
        mimeType: f.v.contentType,
      });
    }

    const created = await db.$transaction(async (tx) => {
      const r = await tx.reimbursement.create({
        data: {
          employeeId: user.employeeId!,
          title: data.title,
          category: data.category,
          amount: data.amount,
          currency: data.currency,
          description: data.description,
          expenseDate,
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

    await audit({
      action: "reimbursement.submit",
      resource: `Reimbursement:${created.id}`,
      diff: { amount: data.amount, category: data.category, receipts: uploaded.length },
    });
    await notifyAdmins({
      type: "REIMBURSEMENT",
      title: "New reimbursement claim",
      message: `${user.name ?? "An employee"} submitted "${data.title}" for ${formatCurrency(data.amount, data.currency)}.`,
      link: "/admin/reimbursements",
    });
    revalidateAll();
    return ok({ id: created.id, status: created.status });
  } catch (err) {
    // Don't orphan receipt objects when the claim itself failed.
    for (const p of uploadedKeys) await deleteFile("reimbursement-receipts", p).catch(() => null);
    if (err instanceof ReadOnlyAccountError) return fail(READ_ONLY_MESSAGE);
    return failFromUnknown(err);
  }
}

const reviewSchema = z.object({
  reimbursementId: z.string(),
  status: z.enum(["UNDER_REVIEW", "APPROVED", "REJECTED", "PAID"]),
  note: z.string().trim().max(1000).optional(),
  paidAmount: z.coerce.number().optional(),
});

const DECISION_COPY: Record<string, string> = {
  UNDER_REVIEW: "is now under review",
  APPROVED: "was approved",
  REJECTED: "was rejected",
  PAID: "was marked paid",
};

export async function reviewReimbursement(
  input: z.input<typeof reviewSchema>,
): Promise<ActionResult<{ id: string; status: string }>> {
  const admin = await requireAdmin();
  try {
    const data = reviewSchema.parse(input);

    if (data.status === "REJECTED" && !data.note) {
      return fail("Enter a reason for rejecting this claim. The employee will see it.");
    }

    const result = await db.$transaction(async (tx) => {
      const current = await tx.reimbursement.findUnique({ where: { id: data.reimbursementId } });
      if (!current) throw new Error("That claim no longer exists. Refresh the page and try again.");

      const from = current.status as ReimbursementStatus;
      if (!canTransition(from, data.status)) {
        throw new Error(
          from === "PAID" || from === "REJECTED"
            ? `This claim is already ${from.toLowerCase()} and can't be changed.`
            : `A ${from.replace("_", " ").toLowerCase()} claim can't be moved to ${data.status.replace("_", " ").toLowerCase()}. Refresh the page.`,
        );
      }

      let paidAmount: number | undefined;
      if (data.status === "PAID") {
        const amount = Number(current.amount);
        paidAmount = data.paidAmount ?? amount;
        const paidCheck = validatePaidAmount(paidAmount, amount, data.note);
        if (!paidCheck.ok) throw new Error(paidCheck.error);
      }

      const now = new Date();
      // Guard against a concurrent review: only update if still in `from`.
      const res = await tx.reimbursement.updateMany({
        where: { id: current.id, status: from },
        data: {
          status: data.status,
          reviewerId: admin.employeeId ?? undefined,
          reviewedAt: now,
          reviewNotes: data.note || undefined,
          approvalDate: data.status === "APPROVED" ? now : undefined,
          paidDate: data.status === "PAID" ? now : undefined,
          paidAmount: data.status === "PAID" ? paidAmount : undefined,
        },
      });
      if (res.count === 0) {
        throw new Error("Someone else just reviewed this claim. Refresh the page.");
      }
      await tx.reimbursementStatusHistory.create({
        data: {
          reimbursementId: current.id,
          status: data.status,
          note: data.note ?? null,
          updatedById: admin.employeeId ?? null,
        },
      });
      return { current, from, paidAmount };
    });

    await audit({
      action: `reimbursement.${data.status.toLowerCase()}`,
      resource: `Reimbursement:${data.reimbursementId}`,
      diff: { from: result.from, status: data.status, paidAmount: result.paidAmount, note: data.note },
    });

    const r = result.current;
    let message = `Your claim "${r.title}" ${DECISION_COPY[data.status]}.`;
    if (data.status === "REJECTED") message += ` Reason: ${data.note}`;
    if (data.status === "PAID" && result.paidAmount !== undefined) {
      message = `Your claim "${r.title}" was paid (${formatCurrency(result.paidAmount, r.currency)}).`;
      if (data.note) message += ` Note: ${data.note}`;
    }
    await notifyEmployees([r.employeeId], {
      type: "REIMBURSEMENT",
      title: `Reimbursement ${data.status.replace("_", " ").toLowerCase()}`,
      message,
      link: "/dashboard/reimbursements",
      priority: data.status === "REJECTED" ? "HIGH" : "MEDIUM",
    });

    revalidateAll();
    return ok({ id: r.id, status: data.status });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Admin: put a rejected claim back in the queue (audited, recorded in history). */
export async function reopenReimbursement(
  input: { reimbursementId: string; note?: string },
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const note = input.note?.trim() || undefined;
    const result = await db.$transaction(async (tx) => {
      const current = await tx.reimbursement.findUnique({ where: { id: input.reimbursementId } });
      if (!current) throw new Error("That claim no longer exists. Refresh the page and try again.");
      if (!canReopen(current.status as ReimbursementStatus)) {
        throw new Error("Only a rejected claim can be reopened.");
      }
      const res = await tx.reimbursement.updateMany({
        where: { id: current.id, status: "REJECTED" },
        data: {
          status: "PENDING",
          reviewerId: null,
          reviewedAt: null,
          reviewNotes: null,
          approvalDate: null,
        },
      });
      if (res.count === 0) throw new Error("This claim changed while you were reopening it. Refresh the page.");
      await tx.reimbursementStatusHistory.create({
        data: {
          reimbursementId: current.id,
          status: "PENDING",
          note: note ? `Reopened: ${note}` : "Reopened",
          updatedById: admin.employeeId ?? null,
        },
      });
      return current;
    });
    await audit({
      action: "reimbursement.reopen",
      resource: `Reimbursement:${input.reimbursementId}`,
      diff: { note },
    });
    await notifyEmployees([result.employeeId], {
      type: "REIMBURSEMENT",
      title: "Reimbursement reopened",
      message: `Your rejected claim "${result.title}" was reopened for review.`,
      link: "/dashboard/reimbursements",
    });
    revalidateAll();
    return ok({ id: result.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}
