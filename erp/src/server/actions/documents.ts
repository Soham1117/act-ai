"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { uploadFile, deleteFile } from "@/lib/storage";
import { audit } from "@/lib/audit";

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
) {
  const user = await requireUser();
  const data = uploadSchema.parse(input);

  const targetEmployeeId =
    user.role === "ADMIN"
      ? data.employeeId ?? user.employeeId
      : user.employeeId;
  if (!targetEmployeeId) throw new Error("No employee context for upload");
  if (user.role !== "ADMIN" && targetEmployeeId !== user.employeeId) {
    throw new Error("Forbidden");
  }

  const path = `${targetEmployeeId}/${Date.now()}-${file.name}`;
  const { publicUrl } = await uploadFile("documents", path, file.bytes, {
    contentType: file.type,
  });
  const doc = await db.document.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      fileName: path,
      fileType: file.type,
      fileUrl: publicUrl,
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
  return doc;
}

const bulkSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  documentType: z.enum(DOC_TYPES),
  employeeIds: z.array(z.string()).min(1),
});

/**
 * Admin-only. Upload one file once and attach it to many employees. The
 * underlying object is shared (single fileUrl), but each employee gets their
 * own Document row so deletes / visibility work per-employee.
 */
export async function uploadDocumentBulk(
  input: z.infer<typeof bulkSchema>,
  file: { name: string; type: string; bytes: ArrayBuffer },
) {
  const admin = await requireAdmin();
  const data = bulkSchema.parse(input);

  const path = `_shared/${Date.now()}-${file.name}`;
  const { publicUrl } = await uploadFile("documents", path, file.bytes, {
    contentType: file.type,
  });

  const docs = await db.$transaction(
    data.employeeIds.map((eid) =>
      db.document.create({
        data: {
          title: data.title,
          description: data.description ?? null,
          fileName: path,
          fileType: file.type,
          fileUrl: publicUrl,
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
      employeeCount: data.employeeIds.length,
    },
  });
  revalidatePath("/admin/documents");
  revalidatePath("/dashboard/documents");
  for (const eid of data.employeeIds) {
    revalidatePath(`/admin/employees/${eid}`);
  }
  return docs;
}

/**
 * Admin can delete any document. Employees may delete documents they
 * uploaded themselves.
 */
export async function deleteDocument(id: string) {
  const user = await requireUser();
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) throw new Error("Not found");

  const isAdmin = user.role === "ADMIN";
  const isUploader = doc.uploadedById === user.id;
  if (!isAdmin && !isUploader) throw new Error("Forbidden");

  // For shared/bulk objects, only remove from storage if no other Document rows
  // still reference the same path.
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
  return { ok: true };
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
