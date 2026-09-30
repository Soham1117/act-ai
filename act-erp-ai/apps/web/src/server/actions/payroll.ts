"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { uploadFile, deleteFile } from "@/lib/storage";
import { parsePaystub } from "@/lib/paystub-parser";
import { matchEmployee, type MatchResult } from "@/lib/paystub-match";
import type { ParsedPaystub } from "@/lib/paystub-parser";
import { validateUpload } from "@/lib/upload-validation";
import { notifyEmployees } from "@/lib/notify";
import { audit } from "@/lib/audit";
import {
  derivePeriodStatus,
  PAYROLL_DUPLICATE_PREFIX,
  validatePeriodDates,
} from "@/lib/payroll-period";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

const uploadSchema = z.object({
  employeeId: z.string().min(1),
  title: z.string().min(2).max(200),
  description: z.string().optional(),
  category: z.string().trim().min(1).max(80).default("Pay Stub"),
  payPeriodStart: dateStr,
  payPeriodEnd: dateStr,
  /** Replace an existing matching document instead of refusing. */
  overwrite: z.boolean().optional(),
});

// IRS Treas. Reg. 31.6051-1: a W-2 can only be furnished electronically with
// the employee's affirmative, electronically-confirmed consent — and they
// must be able to withdraw it. Without consent on file, a W-2 must go out on
// paper; it must not be uploaded here at all. Matches on category name
// (case/punctuation-insensitive) since category is otherwise freeform.
const W2_CATEGORY_ALIASES = new Set(["w-2", "w2", "form w-2", "form w2"]);
function isW2Category(category: string): boolean {
  return W2_CATEGORY_ALIASES.has(category.trim().toLowerCase());
}

/** Pay stubs are PDF-only; other payroll categories (W-2, bonus letters…) may be any allowed document. */
function isPaystubCategory(category: string): boolean {
  return /pay\s*-?\s*stub|paystub/i.test(category);
}

export async function uploadPayrollDocument(
  input: z.infer<typeof uploadSchema>,
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<ActionResult<{ id: string; replaced: number }>> {
  const admin = await requireAdmin();
  try {
    const data = uploadSchema.parse(input);

    if (data.payPeriodEnd < data.payPeriodStart) {
      return fail("The pay period end can't be before the period start.");
    }

    const employee = await db.employee.findUnique({
      where: { id: data.employeeId },
      select: { id: true, w2ConsentAt: true, employmentStatus: true, name: true },
    });
    if (!employee) {
      return fail("That employee no longer exists. Refresh the page and pick someone else.");
    }
    if (employee.employmentStatus === "PENDING_REVIEW") {
      return fail(`${employee.name} hasn't been approved yet. Approve their onboarding before uploading payroll documents.`);
    }

    if (isW2Category(data.category) && !employee.w2ConsentAt) {
      return fail(
        "This employee hasn't consented to electronic W-2 delivery (IRS Treas. Reg. 31.6051-1). " +
          "Deliver their W-2 on paper instead — it cannot be uploaded here without consent on file.",
      );
    }

    const v = validateUpload(isPaystubCategory(data.category) ? "paystub" : "document", {
      name: file.name,
      bytes: file.bytes,
    });
    if (!v.ok) return fail(v.error);

    const periodEnd = new Date(`${data.payPeriodEnd}T00:00:00.000Z`);
    const periodStart = new Date(`${data.payPeriodStart}T00:00:00.000Z`);

    const duplicates = await db.payroll.findMany({
      where: {
        employeeId: data.employeeId,
        OR: [
          { category: data.category, payPeriodEnd: periodEnd },
          { fileSha256: v.sha256 },
        ],
      },
      select: { id: true, title: true, fileName: true },
    });
    if (duplicates.length > 0 && !data.overwrite) {
      return fail(
        `${PAYROLL_DUPLICATE_PREFIX} ${employee.name} already has "${duplicates[0]!.title}" for this category and pay period (or an identical file). ` +
          "Choose Replace to overwrite it, or remove this file.",
      );
    }

    const path = `${data.employeeId}/${data.payPeriodEnd}-${Date.now()}-${v.safeFileName}`;
    const { key } = await uploadFile("payroll", path, file.bytes, { contentType: v.contentType });

    let doc;
    try {
      doc = await db.$transaction(async (tx) => {
        const created = await tx.payroll.create({
          data: {
            employeeId: data.employeeId,
            title: data.title,
            description: data.description ?? null,
            category: data.category,
            fileName: path,
            fileType: v.contentType,
            // Legacy column — reads go through /api/payroll/[id]/file, never this.
            fileUrl: key,
            fileSha256: v.sha256,
            payPeriodStart: periodStart,
            payPeriodEnd: periodEnd,
            uploadedById: admin.id,
            uploaderEmployeeId: admin.employeeId ?? null,
          },
        });
        if (duplicates.length > 0) {
          await tx.payroll.deleteMany({ where: { id: { in: duplicates.map((d) => d.id) } } });
        }
        return created;
      });
    } catch (err) {
      await deleteFile("payroll", path).catch(() => null);
      throw err;
    }

    for (const old of duplicates) {
      await deleteFile("payroll", old.fileName).catch(() => null);
    }

    await audit({
      action: duplicates.length > 0 ? "payroll.document.replace" : "payroll.document.upload",
      resource: `Payroll:${doc.id}`,
      diff: {
        employeeId: data.employeeId,
        category: data.category,
        payPeriodEnd: data.payPeriodEnd,
        replacedIds: duplicates.map((d) => d.id),
      },
    });

    await notifyEmployees([data.employeeId], {
      type: "PAYROLL",
      title: "New pay document available",
      message: `A new ${data.category} document for the pay period ending ${data.payPeriodEnd} is available in Payroll.`,
      link: "/dashboard/payroll",
    });

    revalidatePath("/admin/payroll");
    revalidatePath("/dashboard/payroll");
    return ok({ id: doc.id, replaced: duplicates.length });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export type PaystubPreview = {
  fileName: string;
  parsed: ParsedPaystub | null;
  match: MatchResult;
  duplicateOf: { id: string; title: string } | null;
};

/**
 * Parse one dropped PDF and suggest which employee it belongs to. Read-only —
 * never writes anything. Extraction failures never throw past this boundary;
 * they come back as `parsed: null` / confidence "none" so the admin falls
 * back to picking the employee manually for that one file, without the rest
 * of a batch failing. The duplicate hint is advisory only: the upload action
 * re-checks on submit.
 */
export async function previewPaystub(
  file: { name: string; type: string; bytes: ArrayBuffer },
  category = "Pay Stub",
): Promise<PaystubPreview> {
  await requireAdmin();

  const roster = await db.employee.findMany({
    select: { id: true, name: true, ssnLast4: true },
  });

  let parsed: ParsedPaystub | null = null;
  try {
    parsed = await parsePaystub(file.bytes, file.type);
  } catch {
    parsed = null;
  }

  const match = parsed
    ? matchEmployee(parsed, roster)
    : ({ employeeId: null, confidence: "none", reason: "Couldn't read this file automatically." } as MatchResult);

  let duplicateOf: PaystubPreview["duplicateOf"] = null;
  if (match.employeeId) {
    const sha = createHash("sha256").update(new Uint8Array(file.bytes)).digest("hex");
    const or: Array<Record<string, unknown>> = [{ fileSha256: sha }];
    if (parsed?.payPeriodEnd) {
      or.push({ category, payPeriodEnd: new Date(`${parsed.payPeriodEnd}T00:00:00.000Z`) });
    }
    const existing = await db.payroll.findFirst({
      where: { employeeId: match.employeeId, OR: or },
      select: { id: true, title: true },
    });
    if (existing) duplicateOf = existing;
  }

  return { fileName: file.name, parsed, match, duplicateOf };
}

export async function deletePayrollDocument(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const doc = await db.payroll.findUnique({ where: { id } });
    if (!doc) {
      return fail("That payroll document no longer exists. Refresh the page and try again.");
    }
    await db.payroll.delete({ where: { id } });
    await deleteFile("payroll", doc.fileName).catch(() => null);
    await audit({
      action: "payroll.document.delete",
      resource: `Payroll:${id}`,
      diff: {
        employeeId: doc.employeeId,
        title: doc.title,
        category: doc.category,
        payPeriodEnd: doc.payPeriodEnd.toISOString().slice(0, 10),
      },
    });
    revalidatePath("/admin/payroll");
    revalidatePath("/dashboard/payroll");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

const calendarSchema = z.object({
  title: z.string().trim().min(2).max(200),
  payPeriodStart: z.string(),
  payPeriodEnd: z.string(),
  payDate: z.string(),
  /** AUTO follows the dates; COMPLETED closes the period early (admin override). */
  status: z.enum(["AUTO", "UPCOMING", "CURRENT", "COMPLETED"]).default("AUTO"),
  notes: z.string().max(2000).optional(),
});

function resolveStatus(
  requested: z.infer<typeof calendarSchema>["status"],
  start: Date,
  end: Date,
) {
  return requested === "COMPLETED" ? ("COMPLETED" as const) : derivePeriodStatus(start, end);
}

export async function createPayrollPeriod(
  input: z.input<typeof calendarSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = calendarSchema.parse(input);
    const check = validatePeriodDates(data.payPeriodStart, data.payPeriodEnd, data.payDate);
    if (!check.ok) return fail(check.error);
    const start = new Date(`${data.payPeriodStart}T00:00:00.000Z`);
    const end = new Date(`${data.payPeriodEnd}T00:00:00.000Z`);
    const period = await db.payrollCalendar.create({
      data: {
        title: data.title,
        payPeriodStart: start,
        payPeriodEnd: end,
        payDate: new Date(`${data.payDate}T00:00:00.000Z`),
        status: resolveStatus(data.status, start, end),
        notes: data.notes || null,
        createdById: admin.id,
      },
    });
    await audit({
      action: "payroll.period.create",
      resource: `PayrollCalendar:${period.id}`,
      diff: { title: data.title, start: data.payPeriodStart, end: data.payPeriodEnd },
    });
    revalidatePath("/admin/payroll");
    return ok({ id: period.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function updatePayrollPeriod(
  id: string,
  input: z.input<typeof calendarSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = calendarSchema.parse(input);
    const check = validatePeriodDates(data.payPeriodStart, data.payPeriodEnd, data.payDate);
    if (!check.ok) return fail(check.error);
    const existing = await db.payrollCalendar.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return fail("That pay period no longer exists. Refresh the page and try again.");
    const start = new Date(`${data.payPeriodStart}T00:00:00.000Z`);
    const end = new Date(`${data.payPeriodEnd}T00:00:00.000Z`);
    await db.payrollCalendar.update({
      where: { id },
      data: {
        title: data.title,
        payPeriodStart: start,
        payPeriodEnd: end,
        payDate: new Date(`${data.payDate}T00:00:00.000Z`),
        status: resolveStatus(data.status, start, end),
        notes: data.notes || null,
      },
    });
    await audit({
      action: "payroll.period.update",
      resource: `PayrollCalendar:${id}`,
      diff: { title: data.title, start: data.payPeriodStart, end: data.payPeriodEnd, status: data.status },
    });
    revalidatePath("/admin/payroll");
    revalidatePath(`/admin/payroll/${id}`);
    revalidatePath("/dashboard/payroll");
    return ok({ id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function deletePayrollPeriod(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const existing = await db.payrollCalendar.findUnique({ where: { id } });
    if (!existing) return fail("That pay period was already deleted. Refresh the page.");
    await db.payrollCalendar.delete({ where: { id } });
    await audit({
      action: "payroll.period.delete",
      resource: `PayrollCalendar:${id}`,
      diff: { title: existing.title },
    });
    revalidatePath("/admin/payroll");
    revalidatePath("/dashboard/payroll");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
