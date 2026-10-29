"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { readEmployeePrivateDetails } from "@/server/employee-private-data";
import { requireAdmin } from "@/lib/auth";
import { deleteFile } from "@/lib/storage";
import { parsePaystub, analyzePayrollPdfForGuard } from "@/lib/paystub-parser";
import { PDFDocument } from "pdf-lib";
import { parseDateOnly } from "@/lib/time-rules";
import { analyzePayrollSource, semanticPaystubHash, sourcePageKey, splitPaystubPage } from "@/server/paystub-analysis";
import { persistPayrollDocument, payrollVersion } from "@/server/paystub-persistence";
import { matchEmployee, type MatchResult } from "@/lib/paystub-match";
import type { ParsedPaystub } from "@/lib/paystub-parser";
import { validateUpload } from "@/lib/upload-validation";
import { audit } from "@/lib/audit";
import {
  derivePeriodStatus,
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
  replaceId: z.string().optional(),
  replaceVersion: z.string().optional(),
});

/** Pay stubs are PDF-only; other payroll categories (W-2, bonus letters…) may be any allowed document. */
function isPaystubCategory(category: string): boolean {
  return /pay\s*-?\s*stub|paystub/i.test(category);
}

function refreshPayrollDocuments() {
  try { revalidatePath("/admin/payroll"); revalidatePath("/dashboard/payroll"); }
  catch { console.error("[payroll] saved document cache refresh failed"); }
}

export async function uploadPayrollDocument(
  input: z.infer<typeof uploadSchema>,
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<ActionResult<{ id: string; replaced: number }>> {
  const admin = await requireAdmin();
  try {
    const data = uploadSchema.parse(input);
    if (!parseDateOnly(data.payPeriodStart) || !parseDateOnly(data.payPeriodEnd) || data.payPeriodEnd < data.payPeriodStart) return fail("Enter a valid pay period start and end.");
    const v = validateUpload(isPaystubCategory(data.category) ? "paystub" : "document", file);
    if (!v.ok) return fail(v.error);
    // Inspect all pages independent of the category label. A renamed combined
    // paystub or multi-employee summary must never reach one employee's record.
    if (v.ext === "pdf") {
      const analysis = await analyzePayrollPdfForGuard(file.bytes);
      const recognized = analysis.pages.some((page) => page.status === "SUPPORTED");
      const unsafeReport = analysis.pages.some((page) => /summar(?:y|ies)|register|multiple|more than one|multi.employee/i.test(page.reason ?? ""));
      if (unsafeReport || (recognized && analysis.pageCount !== 1)) return fail("Combined paystubs and payroll summaries cannot be uploaded to one employee. Use the reviewed paystub batch flow.");
      if (recognized && !isPaystubCategory(data.category)) return fail("This PDF is an employee paystub. Use the Pay Stub category and reviewed batch flow.");
      if (isPaystubCategory(data.category)) {
        const page = analysis.pages[0];
        if (analysis.pageCount !== 1 || page?.status !== "SUPPORTED") return fail("Use the reviewed paystub batch flow to analyze this PDF. Unsupported or scanned pages cannot be published without review.");
        // Single supported stubs use the same review and persistence service.
        const preview = await analyzePayrollSource(file);
        const reviewed = preview.pages[0];
        if (reviewed.match.confidence !== "high" || reviewed.match.employeeId !== data.employeeId || reviewed.parsed?.payPeriodStart !== data.payPeriodStart || reviewed.parsed?.payPeriodEnd !== data.payPeriodEnd) return fail("This employee or pay period needs explicit review. Use the paystub batch flow.");
        if (data.overwrite && (!data.replaceId || !data.replaceVersion)) return fail("Select the specific document to replace in the reviewed batch flow.");
        const source = await PDFDocument.load(file.bytes);
        const result = await persistPayrollDocument({ actor: admin, sourcePageCount: 1, expectedRosterHash: preview.rosterHash, employeeId: data.employeeId, title: data.title, description: data.description, category: data.category, payPeriodStart: data.payPeriodStart, payPeriodEnd: data.payPeriodEnd, bytes: await splitPaystubPage(source, 1), fileType: "application/pdf", safeName: "paystub-page-1.pdf", replaceId: data.replaceId, replaceVersion: data.replaceVersion, provenance: { sourceSha256: preview.sourceHash, sourceFileName: v.safeFileName, sourcePage: 1, importKey: sourcePageKey(preview.sourceHash, 1), semanticHash: semanticPaystubHash(reviewed), payDate: reviewed.parsed?.payDate ?? null, checkReference: reviewed.parsed?.checkNumber ?? null } });
        refreshPayrollDocuments();
        return ok({ id: result.id!, replaced: result.replaced ?? 0 });
      }
    }
    if (data.overwrite && (!data.replaceId || !data.replaceVersion)) return fail("Select the specific document to replace; a whole period cannot be overwritten.");
    const result = await persistPayrollDocument({ actor: admin, employeeId: data.employeeId, title: data.title, category: data.category, description: data.description, payPeriodStart: data.payPeriodStart, payPeriodEnd: data.payPeriodEnd, bytes: file.bytes, fileType: v.contentType, safeName: v.safeFileName, replaceId: data.replaceId, replaceVersion: data.replaceVersion });
    refreshPayrollDocuments();
    return ok({ id: result.id!, replaced: result.replaced ?? 0 });
  } catch (error) { return failFromUnknown(error); }
}

export type PaystubPreview = {
  fileName: string;
  parsed: ParsedPaystub | null;
  match: MatchResult;
  duplicateOf: { id: string; title: string; version: string; employeeId: string; payPeriodEnd: string } | null;
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
  selection?: { employeeId: string; payPeriodEnd: string },
): Promise<PaystubPreview> {
  await requireAdmin();

  const storedRoster = await db.employee.findMany({
    select: { id: true, name: true, ssnLast4: true, privateDetails: true },
  });
  const roster = await Promise.all(storedRoster.map(async row => ({
    id: row.id, name: row.name, ssnLast4: (await readEmployeePrivateDetails(row)).ssnLast4,
  })));

  let parsed: ParsedPaystub | null = null;
  try {
    parsed = await parsePaystub(file.bytes, file.type);
  } catch {
    parsed = null;
  }

  const match = parsed
    ? matchEmployee(parsed, roster)
    : ({ employeeId: null, confidence: "none", reason: "Couldn't read this file automatically.", nameOk: false, ssnOk: false } as MatchResult);

  let duplicateOf: PaystubPreview["duplicateOf"] = null;
  const candidateId = selection?.employeeId ?? match.employeeId;
  const candidateEnd = selection?.payPeriodEnd ?? parsed?.payPeriodEnd;
  if (selection && (!roster.some((employee) => employee.id === selection.employeeId) || !parseDateOnly(selection.payPeriodEnd))) throw new Error("Choose a valid employee and pay period before checking duplicates.");
  if (candidateId) {
    const sha = createHash("sha256").update(new Uint8Array(file.bytes)).digest("hex");
    const or: Array<Record<string, unknown>> = [{ fileSha256: sha }];
    if (candidateEnd) {
      or.push({ category, payPeriodEnd: new Date(`${candidateEnd}T00:00:00.000Z`) });
    }
    const existing = await db.payroll.findFirst({
      where: { employeeId: candidateId, OR: or },
      select: { id: true, title: true, fileSha256: true, uploadedAt: true, employeeId: true, payPeriodEnd: true },
    });
    if (existing) duplicateOf = { id: existing.id, title: existing.title, version: payrollVersion(existing), employeeId: existing.employeeId, payPeriodEnd: existing.payPeriodEnd.toISOString().slice(0, 10) };
  }

  return { fileName: file.name, parsed: parsed ? { ...parsed, netPay: null } : null, match, duplicateOf };
}

export async function deletePayrollDocument(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const doc = await db.payroll.findUnique({ where: { id } });
    if (!doc) {
      return fail("That payroll document no longer exists. Refresh the page and try again.", "errors.payroll.thatPayrollDocumentNoLongerExists_76790");
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
    const period = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payroll-calendar-period-writes'))`;
      const overlap = await tx.payrollCalendar.findFirst({
        where: { payPeriodStart: { lte: end }, payPeriodEnd: { gte: start } },
        select: { title: true, payPeriodStart: true, payPeriodEnd: true },
      });
      if (overlap) {
        return {
          error: `This period overlaps "${overlap.title}" (${overlap.payPeriodStart.toISOString().slice(0, 10)} to ${overlap.payPeriodEnd.toISOString().slice(0, 10)}). Choose dates after that period ends, or edit the existing period.`,
        } as const;
      }
      const created = await tx.payrollCalendar.create({
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
      return { created } as const;
    });
    if ("error" in period && period.error) return fail(period.error);
    await audit({
      action: "payroll.period.create",
      resource: `PayrollCalendar:${period.created.id}`,
      diff: { title: data.title, start: data.payPeriodStart, end: data.payPeriodEnd },
    });
    revalidatePath("/admin/payroll");
    return ok({ id: period.created.id });
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
    const start = new Date(`${data.payPeriodStart}T00:00:00.000Z`);
    const end = new Date(`${data.payPeriodEnd}T00:00:00.000Z`);
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payroll-calendar-period-writes'))`;
      const existing = await tx.payrollCalendar.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return { error: "That pay period no longer exists. Refresh the page and try again." } as const;
      const overlap = await tx.payrollCalendar.findFirst({
        where: {
          id: { not: id },
          payPeriodStart: { lte: end },
          payPeriodEnd: { gte: start },
        },
        select: { title: true, payPeriodStart: true, payPeriodEnd: true },
      });
      if (overlap) {
        return {
          error: `This period overlaps "${overlap.title}" (${overlap.payPeriodStart.toISOString().slice(0, 10)} to ${overlap.payPeriodEnd.toISOString().slice(0, 10)}). Choose non-overlapping dates, or edit the other period first.`,
        } as const;
      }
      await tx.payrollCalendar.update({
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
      return { updated: true } as const;
    });
    if ("error" in result && result.error) return fail(result.error);
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
    if (!existing) return fail("That pay period was already deleted. Refresh the page.", "errors.payroll.thatPayPeriodWasAlreadyDeleted_910de");
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
