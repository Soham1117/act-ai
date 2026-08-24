"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { uploadFile, deleteFile } from "@/lib/storage";
import { parsePaystub } from "@/lib/paystub-parser";
import { matchEmployee, type MatchResult } from "@/lib/paystub-match";
import type { ParsedPaystub } from "@/lib/paystub-parser";

const uploadSchema = z.object({
  employeeId: z.string(),
  title: z.string().min(2),
  description: z.string().optional(),
  category: z.string().default("Pay Stub"),
  payPeriodStart: z.string(),
  payPeriodEnd: z.string(),
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

export async function uploadPayrollDocument(
  input: z.infer<typeof uploadSchema>,
  file: { name: string; type: string; bytes: ArrayBuffer },
) {
  const admin = await requireAdmin();
  const data = uploadSchema.parse(input);

  if (isW2Category(data.category)) {
    const employee = await db.employee.findUnique({
      where: { id: data.employeeId },
      select: { w2ConsentAt: true },
    });
    if (!employee?.w2ConsentAt) {
      throw new Error(
        "This employee hasn't consented to electronic W-2 delivery (IRS Treas. Reg. 31.6051-1). " +
          "Deliver their W-2 on paper instead — it cannot be uploaded here without consent on file.",
      );
    }
  }

  const path = `${data.employeeId}/${data.payPeriodEnd}-${Date.now()}-${file.name}`;
  const { key } = await uploadFile("payroll", path, file.bytes, {
    contentType: file.type,
  });
  const doc = await db.payroll.create({
    data: {
      employeeId: data.employeeId,
      title: data.title,
      description: data.description ?? null,
      category: data.category,
      fileName: path,
      fileType: file.type,
      // Legacy column — reads go through /api/payroll/[id]/file, never this.
      fileUrl: key,
      payPeriodStart: new Date(data.payPeriodStart),
      payPeriodEnd: new Date(data.payPeriodEnd),
      uploadedById: admin.id,
      uploaderEmployeeId: admin.employeeId ?? null,
    },
  });
  revalidatePath("/admin/payroll");
  revalidatePath("/dashboard/payroll");
  return doc;
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
 * of a batch failing.
 */
export async function previewPaystub(
  file: { name: string; type: string; bytes: ArrayBuffer },
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
  if (match.employeeId && parsed?.payPeriodEnd) {
    const existing = await db.payroll.findFirst({
      where: { employeeId: match.employeeId, payPeriodEnd: new Date(parsed.payPeriodEnd) },
      select: { id: true, title: true },
    });
    if (existing) duplicateOf = existing;
  }

  return { fileName: file.name, parsed, match, duplicateOf };
}

export async function deletePayrollDocument(id: string) {
  await requireAdmin();
  const doc = await db.payroll.findUnique({ where: { id } });
  if (!doc) throw new Error("Not found");
  await deleteFile("payroll", doc.fileName).catch(() => null);
  await db.payroll.delete({ where: { id } });
  revalidatePath("/admin/payroll");
}

const calendarSchema = z.object({
  title: z.string().min(2),
  payPeriodStart: z.string(),
  payPeriodEnd: z.string(),
  payDate: z.string(),
  status: z.enum(["UPCOMING", "CURRENT", "COMPLETED"]).default("UPCOMING"),
  notes: z.string().optional(),
});

export async function createPayrollPeriod(input: z.infer<typeof calendarSchema>) {
  const admin = await requireAdmin();
  const data = calendarSchema.parse(input);
  const period = await db.payrollCalendar.create({
    data: {
      title: data.title,
      payPeriodStart: new Date(data.payPeriodStart),
      payPeriodEnd: new Date(data.payPeriodEnd),
      payDate: new Date(data.payDate),
      status: data.status,
      notes: data.notes ?? null,
      createdById: admin.id,
    },
  });
  revalidatePath("/admin/payroll");
  return period;
}

export async function deletePayrollPeriod(id: string) {
  await requireAdmin();
  await db.payrollCalendar.delete({ where: { id } });
  revalidatePath("/admin/payroll");
}
