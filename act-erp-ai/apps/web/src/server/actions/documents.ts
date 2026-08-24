"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { uploadFile, deleteFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const DOC_TYPES = ["PERSONAL", "COMPANY", "ONBOARDING", "BENEFITS", "TRAINING"] as const;

const uploadSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  documentType: z.enum(DOC_TYPES),
  /** Optional — admin uploading on behalf of an employee. Ignored for non-admins. */
  employeeId: z.string().optional(),
});

/**
 * Upload a single document. Admins can target any employee (or omit
 * employeeId to attach to themselves). Employees can only upload to their
 * own record.
 */
export async function uploadDocument(
  input: z.infer<typeof uploadSchema>,
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  try {
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

    const path = `${targetEmployeeId}/${Date.now()}-${file.name}`;
    const { key } = await uploadFile("documents", path, file.bytes, {
      contentType: file.type,
    });
    const doc = await db.document.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        fileName: path,
        fileType: file.type,
        // Legacy column — reads go through /api/documents/[id]/file, never this.
        fileUrl: key,
        documentType: data.documentType,
        employeeId: targetEmployeeId,
        uploadedById: user.id,
        uploaderEmployeeId: user.employeeId ?? null,
      },
    });
    await audit({
      action: "document.upload",
      resource: `Document:${doc.id}`,
      diff: {
        title: data.title,
        documentType: data.documentType,
        employeeId: targetEmployeeId,
      },
    });
    revalidatePath("/admin/documents");
    revalidatePath("/dashboard/documents");
    revalidatePath(`/admin/employees/${targetEmployeeId}`);
    return ok({ id: doc.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const bulkSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  documentType: z.enum(DOC_TYPES),
  employeeIds: z.array(z.string()).min(1),
  /**
   * Set when this upload is furnishing a benefits plan document under the
   * 2002 electronic-delivery rule (29 CFR 2520.104b-1(c)) — mirrors
   * uploadPayrollDocument's W-2 check. When true, employeeIds is filtered
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
  input: z.infer<typeof bulkSchema>,
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<ActionResult<{ created: number; skippedEmployeeIds: string[] }>> {
  const admin = await requireAdmin();
  try {
    const data = bulkSchema.parse(input);

    let targetIds = data.employeeIds;
    let skippedEmployeeIds: string[] = [];
    if (data.erisaDisclosure) {
      const consented = await db.employee.findMany({
        where: { id: { in: data.employeeIds }, benefitsEConsentAt: { not: null } },
        select: { id: true },
      });
      const consentedIds = new Set(consented.map((e) => e.id));
      targetIds = data.employeeIds.filter((id) => consentedIds.has(id));
      skippedEmployeeIds = data.employeeIds.filter((id) => !consentedIds.has(id));
    }
    if (targetIds.length === 0) {
      return fail(
        "None of the selected employees have consented to electronic benefits document delivery. " +
          "Deliver this document on paper to them instead.",
      );
    }

    const path = `_shared/${Date.now()}-${file.name}`;
    const { key } = await uploadFile("documents", path, file.bytes, {
      contentType: file.type,
    });

    const docs = await db.$transaction(
      targetIds.map((eid) =>
        db.document.create({
          data: {
            title: data.title,
            description: data.description ?? null,
            fileName: path,
            fileType: file.type,
            fileUrl: key,
            documentType: data.documentType,
            employeeId: eid,
            uploadedById: admin.id,
            uploaderEmployeeId: admin.employeeId ?? null,
          },
        }),
      ),
    );

    await audit({
      action: "document.bulk_upload",
      resource: `Document:_shared/${path}`,
      diff: {
        title: data.title,
        documentType: data.documentType,
        employeeCount: targetIds.length,
        skippedForConsent: skippedEmployeeIds.length,
      },
    });
    revalidatePath("/admin/documents");
    revalidatePath("/dashboard/documents");
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
 * uploaded themselves.
 */
export async function deleteDocument(id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const doc = await db.document.findUnique({ where: { id } });
    if (!doc) {
      return fail("That document no longer exists. Refresh the page and try again.");
    }

    const isAdmin = user.role === "ADMIN";
    const isUploader = doc.uploadedById === user.id;
    if (!isAdmin && !isUploader) {
      return fail("You can only delete documents you uploaded yourself. Ask an admin if you need this removed.");
    }

    const stillReferenced = await db.document.count({
      where: { fileName: doc.fileName, NOT: { id: doc.id } },
    });
    if (stillReferenced === 0) {
      await deleteFile("documents", doc.fileName).catch(() => null);
    }
    await db.document.delete({ where: { id } });

    await audit({
      action: "document.delete",
      resource: `Document:${id}`,
      diff: { title: doc.title, employeeId: doc.employeeId },
    });
    revalidatePath("/admin/documents");
    revalidatePath("/dashboard/documents");
    revalidatePath(`/admin/employees/${doc.employeeId}`);
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function listMyDocuments() {
  const user = await requireUser();
  if (!user.employeeId) return [];
  return db.document.findMany({
    where: {
      OR: [
        { employeeId: user.employeeId },
        { documentType: { in: ["COMPANY", "BENEFITS", "TRAINING"] } },
      ],
    },
    orderBy: { uploadedAt: "desc" },
  });
}
