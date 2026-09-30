"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, requireAdmin, requireWritableUser, ReadOnlyAccountError } from "@/lib/auth";
import { READ_ONLY_MESSAGE } from "@/lib/access";
import { uploadFile, deleteFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { validateUpload } from "@/lib/upload-validation";
import { notifyEmployees } from "@/lib/notify";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const DOC_TYPES = ["PERSONAL", "COMPANY", "ONBOARDING", "BENEFITS", "TRAINING"] as const;

const uploadSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().optional(),
  documentType: z.enum(DOC_TYPES),
  /** Optional — admin uploading on behalf of an employee. Ignored for non-admins. */
  employeeId: z.string().optional(),
});

function handleError(err: unknown) {
  if (err instanceof ReadOnlyAccountError) return fail(READ_ONLY_MESSAGE);
  return failFromUnknown(err);
}

/**
 * Visibility model (same in listMyDocuments, the employee page, and the
 * download route): an employee sees exactly the Document rows whose
 * employeeId is theirs. "Company-wide" / benefits / training documents are
 * delivered by the admin bulk upload, which creates one row per recipient
 * (sharing one stored object). Nothing is visible by type alone.
 */

/**
 * Upload a single document. Admins can target any employee (or omit
 * employeeId to attach to themselves). Employees can only upload to their
 * own record (and not while their account is read-only).
 */
export async function uploadDocument(
  input: z.infer<typeof uploadSchema>,
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireWritableUser();
    const data = uploadSchema.parse(input);

    const targetEmployeeId =
      user.role === "ADMIN"
        ? data.employeeId ?? user.employeeId
        : user.employeeId;
    if (!targetEmployeeId) {
      return fail(
        "No employee profile is linked to your account for this upload. Ask an admin to create one, or pick an employee if you are an admin.",
      );
    }
    if (user.role !== "ADMIN" && targetEmployeeId !== user.employeeId) {
      return fail("You can only upload documents to your own employee profile.");
    }
    if (user.role !== "ADMIN" && (data.documentType === "COMPANY" || data.documentType === "BENEFITS")) {
      return fail("Only admins can upload company or benefits documents.");
    }

    const target = await db.employee.findUnique({
      where: { id: targetEmployeeId },
      select: { id: true },
    });
    if (!target) return fail("That employee no longer exists. Refresh the page and try again.");

    const v = validateUpload("document", { name: file.name, bytes: file.bytes });
    if (!v.ok) return fail(v.error);

    const path = `${targetEmployeeId}/${Date.now()}-${v.safeFileName}`;
    const { key } = await uploadFile("documents", path, file.bytes, {
      contentType: v.contentType,
    });
    let doc;
    try {
      doc = await db.document.create({
        data: {
          title: data.title,
          description: data.description ?? null,
          fileName: path,
          fileType: v.contentType,
          // Legacy column — reads go through /api/documents/[id]/file, never this.
          fileUrl: key,
          documentType: data.documentType,
          employeeId: targetEmployeeId,
          uploadedById: user.id,
          uploaderEmployeeId: user.employeeId ?? null,
        },
      });
    } catch (err) {
      await deleteFile("documents", path).catch(() => null);
      throw err;
    }
    await audit({
      action: "document.upload",
      resource: `Document:${doc.id}`,
      diff: {
        title: data.title,
        documentType: data.documentType,
        employeeId: targetEmployeeId,
        sha256: v.sha256,
      },
    });
    if (user.role === "ADMIN" && targetEmployeeId !== user.employeeId) {
      await notifyEmployees([targetEmployeeId], {
        type: "COMPANY",
        title: "New document available",
        message: `A new document "${data.title}" was added to your documents.`,
        link: "/dashboard/documents",
      });
    }
    revalidatePath("/admin/documents");
    revalidatePath("/dashboard/documents");
    revalidatePath(`/admin/employees/${targetEmployeeId}`);
    return ok({ id: doc.id });
  } catch (err) {
    return handleError(err);
  }
}

const bulkSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().optional(),
  documentType: z.enum(DOC_TYPES),
  employeeIds: z.array(z.string()).default([]),
  /** Deliver to every ACTIVE / ON_LEAVE employee (resolved server-side at upload time). */
  allActive: z.boolean().optional(),
  /**
   * Set when this upload is furnishing a benefits plan document under the
   * 2002 electronic-delivery rule (29 CFR 2520.104b-1(c)) — mirrors
   * uploadPayrollDocument's W-2 check. When true, recipients are filtered
   * down to those with Employee.benefitsEConsentAt set, and anyone dropped
   * is returned in skippedEmployeeIds so the admin knows exactly who still
   * needs a printed copy. NOT required for other document types, and NOT
   * required just to show an employee their own coverage/member ID on the
   * Benefits page — that's not "furnishing a plan document" and gating it
   * would satisfy nothing the regulation asks for.
   */
  erisaDisclosure: z.boolean().optional(),
});

/**
 * Admin-only. Upload one file once and attach it to many employees. The
 * underlying object is shared (single fileUrl), but each employee gets their
 * own Document row so deletes / visibility work per-employee.
 */
export async function uploadDocumentBulk(
  input: z.input<typeof bulkSchema>,
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<ActionResult<{ created: number; skippedEmployeeIds: string[] }>> {
  const admin = await requireAdmin();
  try {
    const data = bulkSchema.parse(input);

    let requested = data.employeeIds;
    if (data.allActive) {
      const all = await db.employee.findMany({
        where: { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
        select: { id: true },
      });
      requested = all.map((e) => e.id);
    }
    if (requested.length === 0) {
      return fail("Select at least one employee (or choose all active employees).");
    }
    // Only employees that actually exist.
    const existing = await db.employee.findMany({
      where: { id: { in: requested } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((e) => e.id));
    requested = requested.filter((id) => existingIds.has(id));
    if (requested.length === 0) {
      return fail("None of the selected employees exist any more. Refresh the page and try again.");
    }

    let targetIds = requested;
    let skippedEmployeeIds: string[] = [];
    if (data.erisaDisclosure) {
      const consented = await db.employee.findMany({
        where: { id: { in: requested }, benefitsEConsentAt: { not: null } },
        select: { id: true },
      });
      const consentedIds = new Set(consented.map((e) => e.id));
      targetIds = requested.filter((id) => consentedIds.has(id));
      skippedEmployeeIds = requested.filter((id) => !consentedIds.has(id));
    }
    if (targetIds.length === 0) {
      return fail(
        "None of the selected employees have consented to electronic benefits document delivery. " +
          "Deliver this document on paper to them instead.",
      );
    }

    const v = validateUpload("document", { name: file.name, bytes: file.bytes });
    if (!v.ok) return fail(v.error);

    const path = `_shared/${Date.now()}-${v.safeFileName}`;
    const { key } = await uploadFile("documents", path, file.bytes, {
      contentType: v.contentType,
    });

    let docs;
    try {
      docs = await db.$transaction(
        targetIds.map((eid) =>
          db.document.create({
            data: {
              title: data.title,
              description: data.description ?? null,
              fileName: path,
              fileType: v.contentType,
              fileUrl: key,
              documentType: data.documentType,
              employeeId: eid,
              uploadedById: admin.id,
              uploaderEmployeeId: admin.employeeId ?? null,
            },
          }),
        ),
      );
    } catch (err) {
      await deleteFile("documents", path).catch(() => null);
      throw err;
    }

    await audit({
      action: "document.bulk_upload",
      resource: `Document:${docs[0]!.id}`,
      diff: {
        title: data.title,
        documentType: data.documentType,
        storedAs: path,
        allActive: !!data.allActive,
        employeeCount: targetIds.length,
        skippedForConsent: skippedEmployeeIds.length,
      },
    });
    await notifyEmployees(targetIds, {
      type: data.documentType === "BENEFITS" ? "BENEFITS" : "COMPANY",
      title: "New document available",
      message: `A new document "${data.title}" was added to your documents.`,
      link: "/dashboard/documents",
    });
    revalidatePath("/admin/documents");
    revalidatePath("/dashboard/documents");
    revalidatePath("/dashboard/benefits");
    for (const eid of targetIds) {
      revalidatePath(`/admin/employees/${eid}`);
    }
    return ok({ created: docs.length, skippedEmployeeIds });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/**
 * Admin can delete any document. Employees may delete documents they
 * uploaded themselves (unless their account is read-only).
 */
export async function deleteDocument(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const isAdmin = user.role === "ADMIN";
    if (!isAdmin) await requireWritableUser();

    const doc = await db.document.findUnique({ where: { id } });
    if (!doc) {
      return fail("That document no longer exists. Refresh the page and try again.");
    }

    const isUploader = doc.uploadedById === user.id;
    if (!isAdmin && !isUploader) {
      return fail("You can only delete documents you uploaded yourself. Ask an admin if you need this removed.");
    }

    await db.document.delete({ where: { id } });
    const stillReferenced = await db.document.count({
      where: { fileName: doc.fileName },
    });
    if (stillReferenced === 0) {
      await deleteFile("documents", doc.fileName).catch(() => null);
    }

    await audit({
      action: "document.delete",
      resource: `Document:${id}`,
      diff: { title: doc.title, employeeId: doc.employeeId },
    });
    revalidatePath("/admin/documents");
    revalidatePath("/dashboard/documents");
    revalidatePath("/dashboard/benefits");
    revalidatePath(`/admin/employees/${doc.employeeId}`);
    return ok();
  } catch (err) {
    return handleError(err);
  }
}

/** The documents this employee can actually open: their own rows, nothing else. */
export async function listMyDocuments() {
  const user = await requireUser();
  if (!user.employeeId) return [];
  return db.document.findMany({
    where: { employeeId: user.employeeId },
    orderBy: { uploadedAt: "desc" },
  });
}
