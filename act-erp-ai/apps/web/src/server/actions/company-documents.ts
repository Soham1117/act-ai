"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { uploadFile, deleteFile } from "@/lib/storage";
import { validateUpload } from "@/lib/upload-validation";
import { companyDocumentSchema, allowedCompanyPurpose, type CompanyDocumentInput } from "@/lib/company-documents";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

function refresh() { revalidatePath("/admin/documents/company"); revalidatePath("/admin/onboarding/checklists"); }

export async function uploadCompanyDocument(input: CompanyDocumentInput, file: {name: string; type: string; bytes: ArrayBuffer}): Promise<ActionResult<{id: string; versionId: string}>> {
  const admin = await requireAdmin();
  let stagedPath: string | null = null;
  try {
    const data = companyDocumentSchema.parse(input);
    const validation = validateUpload("document", {name: file.name, bytes: file.bytes});
    if (!validation.ok) return fail(validation.error);
    const duplicate = await db.companyDocumentVersion.findUnique({where: {sha256: validation.sha256}, select: {document: {select: {title: true}}}});
    if (duplicate) return fail(`This exact file is already in the company library: ${duplicate.document.title}.`);
    const documentId = data.documentId ?? randomUUID();
    const versionId = randomUUID();
    stagedPath = `company-library/${documentId}/${versionId}/${validation.safeFileName}`;
    await uploadFile("documents", stagedPath, file.bytes, {contentType: validation.contentType});
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`company-document:${documentId}`}))`;
      if (data.documentId) {
        const doc = await tx.companyDocument.findUnique({where: {id: documentId}});
        if (!doc || doc.isArchived) throw new Error("This document is missing or archived. Refresh the page.");
        if (doc.category !== data.category) throw new Error("A new version must keep the document category.");
      } else {
        await tx.companyDocument.create({data: {id: documentId, title: data.title, category: data.category, issuer: data.issuer || null, createdById: admin.id}});
      }
      const previous = await tx.companyDocumentVersion.aggregate({where: {documentId}, _max: {version: true}});
      await tx.companyDocumentVersion.create({data: {
        id: versionId, documentId, version: (previous._max.version ?? 0) + 1,
        originalName: file.name.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 200), fileName: stagedPath!, fileType: validation.contentType,
        sha256: validation.sha256, sizeBytes: file.bytes.byteLength, createdById: admin.id,
        year: data.year, quarter: data.quarter,
        periodStart: data.periodStart ? new Date(`${data.periodStart}T00:00:00Z`) : null,
        periodEnd: data.periodEnd ? new Date(`${data.periodEnd}T00:00:00Z`) : null,
        effectiveDate: data.effectiveDate ? new Date(`${data.effectiveDate}T00:00:00Z`) : null,
        sourceReference: data.sourceReference || null, notes: data.notes || null,
      }});
      await tx.auditLog.create({data: {actorId: admin.id, actorEmail: admin.email, action: "company.document.upload", resource: `CompanyDocumentVersion:${versionId}`, diff: {documentId, category: data.category, sha256: validation.sha256}}});
    });
    stagedPath = null;
    refresh();
    return ok({id: documentId, versionId});
  } catch (error) {
    if (stagedPath) await deleteFile("documents", stagedPath).catch(() => console.error("[company-library] staged object cleanup failed"));
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return fail("This file was already uploaded. Refresh the company library.");
    return failFromUnknown(error);
  }
}

export async function approveCompanyVersion(input: {id: string; purpose: string; reason: string}): Promise<ActionResult> {
  const admin = await requireAdmin();
  try {
    const data = z.object({id: z.string().min(1), purpose: z.enum(["HR_ONLY", "ONBOARDING_TEMPLATE", "BENEFIT_RESOURCE"]), reason: z.string().trim().min(3).max(500)}).parse(input);
    await db.$transaction(async (tx) => {
      const version = await tx.companyDocumentVersion.findUnique({where: {id: data.id}, include: {document: true}});
      if (!version || version.document.isArchived) throw new Error("This version is missing or archived.");
      if (!allowedCompanyPurpose(version.document.category, data.purpose)) throw new Error("This category cannot be used for that purpose. Payroll and tax documents remain HR only.");
      if (version.status === "APPROVED") {
        if (version.purpose === data.purpose) return;
        throw new Error("An approved version's purpose cannot change. Upload a new version instead.");
      }
      const updated = await tx.companyDocumentVersion.updateMany({where: {id: data.id, status: "DRAFT"}, data: {status: "APPROVED", purpose: data.purpose, approvedAt: new Date(), approvedById: admin.id}});
      if (updated.count !== 1) throw new Error("This version changed during review. Refresh the page.");
      await tx.auditLog.create({data: {actorId: admin.id, actorEmail: admin.email, action: "company.document.approve", resource: `CompanyDocumentVersion:${data.id}`, diff: {purpose: data.purpose, reason: data.reason}}});
    });
    refresh(); return ok();
  } catch (error) { return failFromUnknown(error); }
}

export async function setCompanyDocumentArchived(input: {id: string; archived: boolean; reason: string}): Promise<ActionResult> {
  const admin = await requireAdmin();
  try {
    const data = z.object({id: z.string().min(1), archived: z.boolean(), reason: z.string().trim().min(3).max(500)}).parse(input);
    await db.$transaction(async (tx) => {
      const before = await tx.companyDocument.findUnique({where: {id: data.id}});
      if (!before) throw new Error("This document no longer exists.");
      await tx.companyDocument.update({where: {id: data.id}, data: {isArchived: data.archived}});
      await tx.auditLog.create({data: {actorId: admin.id, actorEmail: admin.email, action: data.archived ? "company.document.archive" : "company.document.restore", resource: `CompanyDocument:${data.id}`, diff: {before: before.isArchived, after: data.archived, reason: data.reason}}});
    });
    refresh(); return ok();
  } catch (error) { return failFromUnknown(error); }
}
