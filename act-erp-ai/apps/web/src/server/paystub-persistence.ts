import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { uploadFile, deleteFile } from "@/lib/storage";
import type { BatchDecision, BatchReceipt } from "@/lib/paystub-import";

type Provenance = { sourceSha256: string; sourceFileName: string; sourcePage: number; importKey: string; semanticHash: string | null; payDate: string | null; checkReference: string | null };
type SaveInput = {
  actor: { id: string; email?: string | null; employeeId?: string | null };
  employeeId: string; title: string; category: string; description?: string;
  payPeriodStart: string; payPeriodEnd: string; bytes: ArrayBuffer; fileType: string; safeName: string;
  provenance?: Provenance; decision?: BatchDecision;
  replaceId?: string; replaceVersion?: string;
  expectedRosterHash?: string;
  sourcePageCount?: number;
};
const iso = (date: Date) => date.toISOString().slice(0, 10);
export function payrollVersion(row: { id: string; fileSha256: string | null; uploadedAt: Date }): string {
  return createHash("sha256").update(JSON.stringify([row.id, row.fileSha256, row.uploadedAt.toISOString()])).digest("hex");
}

/** Shared by single uploads and reviewed batches. Objects are staged privately,
 * then one transaction owns duplicate checks, replacement, audit and notification. */
export async function persistPayrollDocument(input: SaveInput): Promise<BatchReceipt & { replaced?: number }> {
  const pageNumber = input.provenance?.sourcePage ?? 1;
  const sha = createHash("sha256").update(new Uint8Array(input.bytes)).digest("hex");
  const path = `${input.employeeId}/${input.payPeriodEnd}-${randomUUID()}-${input.safeName}`;
  let committed = false;
  let oldPath: string | null = null;
  try {
    await uploadFile("payroll", path, input.bytes, { contentType: input.fileType });
    const result = await db.$transaction(async (tx) => {
      // One ordering across every writer, including legacy single uploads.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payroll-document-write'))`;
      if (input.expectedRosterHash) {
        const roster = await tx.employee.findMany({ where: { employmentStatus: { not: "PENDING_REVIEW" } }, select: { id: true, name: true, ssnLast4: true, privateDetails: true, employmentStatus: true }, orderBy: { id: "asc" } });
        if (createHash("sha256").update(JSON.stringify(roster)).digest("hex") !== input.expectedRosterHash) throw new Error("The roster changed during review. Analyze this file again.");
      }
      const employee = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, employmentStatus: true, w2ConsentAt: true } });
      if (!employee || employee.employmentStatus === "PENDING_REVIEW") throw new Error("This employee is missing or their onboarding is not approved.");
      if (/^(?:form[ -]?)?w[ -]?2$/i.test(input.category.trim()) && !employee.w2ConsentAt) throw new Error("Electronic W-2 consent is required. Deliver this W-2 on paper.");
      if (input.provenance) {
        const receipt = await tx.payroll.findUnique({ where: { importKey: input.provenance.importKey } });
        if (receipt) {
          if (receipt.employeeId !== input.employeeId || iso(receipt.payPeriodStart) !== input.payPeriodStart || iso(receipt.payPeriodEnd) !== input.payPeriodEnd) throw new Error("This source page was already saved with a different employee or period. It cannot be reassigned by retrying.");
          return { pageNumber, status: "EXISTING" as const, id: receipt.id, replaced: 0 };
        }
      }
      const originalSingleHash = input.provenance && input.sourcePageCount === 1 ? input.provenance.sourceSha256 : null;
      const duplicates = await tx.payroll.findMany({ where: { OR: [
        input.provenance ? { fileSha256: sha } : { employeeId: input.employeeId, fileSha256: sha },
        ...(originalSingleHash ? [{ fileSha256: originalSingleHash }] : []),
        ...(input.provenance?.semanticHash ? [{ semanticHash: input.provenance.semanticHash }] : []),
        { employeeId: input.employeeId, category: input.category, payPeriodEnd: new Date(input.payPeriodEnd + "T00:00:00Z") },
      ] } });
      // Exact content/semantic identity cannot be copied to another employee.
      const exact = duplicates.find((row) => row.fileSha256 === sha || (originalSingleHash && row.fileSha256 === originalSingleHash) || (input.provenance?.semanticHash && row.semanticHash === input.provenance.semanticHash));
      if (exact && exact.employeeId !== input.employeeId) throw new Error("This paystub is already assigned to another employee. Review the existing document before proceeding.");
      const replacementId = input.decision?.duplicateMode === "REPLACE" ? input.decision.replaceId : input.replaceId;
      let replacement = null;
      if (replacementId) {
        replacement = await tx.payroll.findUnique({ where: { id: replacementId } });
        if (!replacement || replacement.employeeId !== input.employeeId || replacement.category !== input.category || iso(replacement.payPeriodEnd) !== input.payPeriodEnd) throw new Error("The selected replacement is missing or belongs to another employee, category, or period.");
        if (payrollVersion(replacement) !== (input.decision?.replaceVersion ?? input.replaceVersion)) throw new Error("The selected document changed. Analyze the file again before replacing it.");
      }
      if (exact && exact.id !== replacement?.id) throw new Error("Duplicate pay document: identical contents or check reference already exist. Keep the existing document or replace that specific document.");
      if (duplicates.length && !replacement && input.decision?.duplicateMode !== "ADDITIONAL") throw new Error("Duplicate pay document: a document already exists for this employee and period. Explicitly keep it, replace one specific document, or confirm an additional check.");
      if (replacement && duplicates.some((row) => row.id !== replacement.id && (row.fileSha256 === sha || (input.provenance?.semanticHash && row.semanticHash === input.provenance.semanticHash)))) throw new Error("Another identical document already exists. Keep the existing document.");
      const created = await tx.payroll.create({ data: {
        employeeId: input.employeeId, title: input.title, description: input.description ?? null, category: input.category,
        fileName: path, fileType: input.fileType, fileUrl: `payroll/${path}`, fileSha256: sha,
        payPeriodStart: new Date(input.payPeriodStart + "T00:00:00Z"), payPeriodEnd: new Date(input.payPeriodEnd + "T00:00:00Z"),
        uploadedById: input.actor.id, uploaderEmployeeId: input.actor.employeeId ?? null,
        ...(input.provenance ? { ...input.provenance, payDate: input.provenance.payDate ? new Date(input.provenance.payDate + "T00:00:00Z") : null } : {}),
      } });
      if (replacement) {
        await tx.payroll.delete({ where: { id: replacement.id } });
        oldPath = replacement.fileName;
      }
      await tx.auditLog.create({ data: { actorId: input.actor.id, actorEmail: input.actor.email ?? null, action: replacement ? "payroll.document.replace" : "payroll.document.upload", resource: `Payroll:${created.id}`, diff: {
        employeeId: input.employeeId, category: input.category, payPeriodEnd: input.payPeriodEnd,
        replacedIds: replacement ? [replacement.id] : [],
        ...(input.provenance ? { sourceSha256: input.provenance.sourceSha256, sourcePage: pageNumber, importKey: input.provenance.importKey, reviewed: true,
          overrideReason: input.decision?.overrideReason ?? null, dateReason: input.decision?.dateReason ?? null, duplicateMode: input.decision?.duplicateMode ?? "KEEP" } : {}),
      } } });
      // Atomic with the document: a retry never sends a second notification.
      await tx.notification.create({ data: { type: "PAYROLL", title: "New pay document available", message: `A new ${input.category} document for the pay period ending ${input.payPeriodEnd} is available in Payroll.`, link: "/dashboard/payroll", translationKey: "notificationTemplates.payrollAvailable", translationParams: { category: input.category, payPeriodEnd: input.payPeriodEnd }, recipients: { create: { employeeId: input.employeeId } } } });
      return { pageNumber, status: "SAVED" as const, id: created.id, replaced: replacement ? 1 : 0 };
    });
    committed = result.status === "SAVED";
    let warning: string | undefined;
    if (!committed) await deleteFile("payroll", path).catch(() => { warning = "Already saved; cleanup of a staged private object needs an administrator retry."; console.error("[payroll] staged private object cleanup failed"); });
    if (oldPath) await deleteFile("payroll", oldPath).catch(() => { warning = "Saved successfully; removal of the old private storage object needs an administrator retry."; console.error("[payroll] old private object cleanup failed"); });
    return { ...result, ...(warning ? { warning } : {}) };
  } catch (error) {
    if (!committed) await deleteFile("payroll", path).catch(() => console.error("[payroll] staged private object cleanup failed"));
    throw error;
  }
}
