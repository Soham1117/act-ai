"use server";

import { PDFDocument } from "pdf-lib";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, failFromUnknown, ok, type ActionResult } from "@/lib/action-result";
import { parseDateOnly } from "@/lib/time-rules";
import { shouldNotifyForStub, type BatchDecision, type BatchPeriodSummary, type BatchPreview, type BatchReceipt } from "@/lib/paystub-import";
import { stubNameKey } from "@/lib/paystub-match";
import { deleteFile } from "@/lib/storage";
import { ensureImportPeriods, IMPORT_PERIOD_NOTE, type ImportPeriod } from "@/server/paystub-periods";
import { analyzePayrollSource, semanticPaystubHash, sourcePageKey, splitPaystubPage, type SourceFile } from "@/server/paystub-analysis";
import { persistPayrollDocument } from "@/server/paystub-persistence";

const day = z.string().refine((value) => !!parseDateOnly(value), "Enter a valid calendar date.");
const decisionSchema = z.object({
  pageNumber: z.number().int().min(1).max(200), employeeId: z.string().min(1), payPeriodStart: day, payPeriodEnd: day,
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true), overrideReason: z.string().trim().max(500).optional(), dateReason: z.string().trim().max(500).optional(),
  duplicateMode: z.enum(["KEEP", "ADDITIONAL", "REPLACE"]), replaceId: z.string().optional(), replaceVersion: z.string().optional(),
});

export async function previewPaystubBatch(file: SourceFile, options?: { ocr?: boolean }): Promise<ActionResult<BatchPreview>> {
  await requireAdmin();
  try { return ok(await analyzePayrollSource(file, options?.ocr === true)); }
  catch (error) { return failFromUnknown(error); }
}

export async function confirmPaystubBatch(input: { sourceHash: string; ocr: boolean; rows: BatchDecision[] }, file: SourceFile): Promise<ActionResult<{ results: BatchReceipt[]; periods: BatchPeriodSummary }>> {
  const actor = await requireAdmin();
  try {
    const data = z.object({ sourceHash: z.string().regex(/^[a-f0-9]{64}$/), ocr: z.boolean(), rows: z.array(decisionSchema).min(1).max(200) }).parse(input);
    if (new Set(data.rows.map((row) => row.pageNumber)).size !== data.rows.length) return fail("A page can only be selected once per review.");
    const preview = await analyzePayrollSource(file, data.ocr);
    if (preview.sourceHash !== data.sourceHash) return fail("The source file changed. Analyze it again before saving.");
    const source = await PDFDocument.load(file.bytes);
    const results: BatchReceipt[] = [];
    const filed: ImportPeriod[] = [];
    for (const decision of data.rows) {
      try {
        const page = preview.pages.find((page) => page.pageNumber === decision.pageNumber);
        if (!page || page.status !== "SUPPORTED" || !page.parsed) throw new Error(page?.reason ?? "This page is unsupported and cannot be published.");
        const receipt = await db.payroll.findUnique({ where: { importKey: sourcePageKey(preview.sourceHash, page.pageNumber) } });
        if (receipt) {
          if (receipt.employeeId !== decision.employeeId || receipt.payPeriodStart.toISOString().slice(0, 10) !== decision.payPeriodStart || receipt.payPeriodEnd.toISOString().slice(0, 10) !== decision.payPeriodEnd) throw new Error("This page was already saved with a different employee or period.");
          results.push({ pageNumber: page.pageNumber, status: "EXISTING", id: receipt.id });
          filed.push({ start: decision.payPeriodStart, end: decision.payPeriodEnd, payDate: page.parsed.payDate });
          continue;
        }
        if (decision.reviewToken !== page.reviewToken) throw new Error("The source or roster evidence changed. Analyze this file again and review the match.");
        if (decision.payPeriodEnd < decision.payPeriodStart) throw new Error("The period end cannot be before the start.");
        if ((page.match.confidence !== "high" || decision.employeeId !== page.match.employeeId || page.extraction === "OCR") && (!decision.overrideReason || decision.overrideReason.length < 3)) throw new Error("Enter a reason confirming this employee match before saving.");
        if ((decision.payPeriodStart !== page.parsed.payPeriodStart || decision.payPeriodEnd !== page.parsed.payPeriodEnd) && (!decision.dateReason || decision.dateReason.length < 3)) throw new Error("The selected dates differ from the stub. Confirm the correction with a reason.");
        if (decision.duplicateMode === "REPLACE" && (!decision.replaceId || !decision.replaceVersion)) throw new Error("Select the specific existing document to replace.");
        const bytes = await splitPaystubPage(source, page.pageNumber);
        const saved = await persistPayrollDocument({
          actor, sourcePageCount: preview.pageCount, expectedRosterHash: preview.rosterHash, employeeId: decision.employeeId, title: `Pay Stub — ${decision.payPeriodEnd}`, category: "Pay Stub",
          payPeriodStart: decision.payPeriodStart, payPeriodEnd: decision.payPeriodEnd, bytes, fileType: "application/pdf", safeName: `paystub-page-${page.pageNumber}.pdf`, decision,
          provenance: { sourceSha256: preview.sourceHash, sourceFileName: file.name.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 200), sourcePage: page.pageNumber, importKey: sourcePageKey(preview.sourceHash, page.pageNumber), semanticHash: semanticPaystubHash(page), payDate: page.parsed.payDate, checkReference: page.parsed.checkNumber?.slice(0, 100) ?? null },
          notify: shouldNotifyForStub(page.parsed.payDate ?? decision.payPeriodEnd),
        });
        results.push(saved);
        if (saved.status === "SAVED" || saved.status === "EXISTING") {
          filed.push({ start: decision.payPeriodStart, end: decision.payPeriodEnd, payDate: page.parsed.payDate });
        }
        if (saved.status === "SAVED" && page.parsed.employeeName && !page.match.nameOk) await rememberStubName(actor.id, decision.employeeId, page.parsed.employeeName);
      } catch (error) { const result = failFromUnknown(error); results.push({ pageNumber: decision.pageNumber, status: "FAILED", error: result.error }); }
    }
    try { revalidatePath("/admin/payroll"); revalidatePath("/dashboard/payroll"); }
    catch { for (const result of results) if (result.status !== "FAILED") result.warning = "Saved successfully. Refresh the payroll page to see the latest documents."; }
    const periods = await ensureImportPeriods(actor.id, filed).catch(() => ({ created: [], existing: 0, skipped: [] }));
    try { if (periods.created.length) revalidatePath("/admin/payroll"); } catch { /* list refreshes on next load */ }
    return ok({ results, periods });
  } catch (error) { return failFromUnknown(error); }
}

/** Best effort: the stub is already saved, so a failure here must never fail the import. */
async function rememberStubName(actorId: string, employeeId: string, stubName: string) {
  const aliasKey = stubNameKey(stubName);
  if (!aliasKey) return;
  await db.paystubNameAlias.upsert({
    where: { aliasKey_employeeId: { aliasKey, employeeId } },
    create: { aliasKey, aliasName: stubName.slice(0, 200), employeeId, createdById: actorId },
    update: {},
  }).catch(() => undefined);
}

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Removes pages saved by one import: only the caller's own imported documents
 * from the last 24 hours, plus periods that import auto-created and that hold
 * no other documents. Replaced originals are not restored, so the UI does not
 * offer this for batches that replaced documents.
 */
export async function undoPaystubBatch(input: { documentIds: string[]; periodIds: string[] }): Promise<ActionResult<{ removedDocuments: number; removedPeriods: number }>> {
  const actor = await requireAdmin();
  try {
    const data = z.object({ documentIds: z.array(z.string().min(1)).max(500), periodIds: z.array(z.string().min(1)).max(100) }).parse(input);
    const since = new Date(Date.now() - UNDO_WINDOW_MS);
    const docs = await db.payroll.findMany({ where: { id: { in: data.documentIds }, uploadedById: actor.id, importKey: { not: null }, uploadedAt: { gte: since } } });
    if (docs.length) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payroll-document-write'))`;
        await tx.payroll.deleteMany({ where: { id: { in: docs.map((doc) => doc.id) } } });
        await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email ?? null, action: "payroll.import.undo", resource: "Payroll:batch", diff: { documentIds: docs.map((doc) => doc.id) } } });
      });
      for (const doc of docs) await deleteFile("payroll", doc.fileName).catch(() => console.error("[payroll] undo: private object cleanup failed"));
    }
    let removedPeriods = 0;
    for (const id of data.periodIds) {
      const period = await db.payrollCalendar.findUnique({ where: { id } });
      if (!period || period.notes !== IMPORT_PERIOD_NOTE || period.createdById !== actor.id || period.createdAt < since) continue;
      const remaining = await db.payroll.count({ where: { payPeriodStart: { lte: period.payPeriodEnd }, payPeriodEnd: { gte: period.payPeriodStart } } });
      if (remaining) continue;
      await db.payrollCalendar.delete({ where: { id } });
      await db.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email ?? null, action: "payroll.period.delete", resource: `PayrollCalendar:${id}`, diff: { source: "paystub-import-undo" } } });
      removedPeriods++;
    }
    try { revalidatePath("/admin/payroll"); revalidatePath("/dashboard/payroll"); } catch { /* refreshes on next load */ }
    return ok({ removedDocuments: docs.length, removedPeriods });
  } catch (error) { return failFromUnknown(error); }
}
