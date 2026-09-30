"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, requireWritableUser } from "@/lib/auth";
import { aiEnabled } from "@/lib/features";
import { uploadFile } from "@/lib/storage";
import { enqueueIngestion } from "@/lib/queue";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const MIME_TO_KIND: Record<string, "PDF" | "DOCX" | "CSV" | "XLSX"> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "text/csv": "CSV",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
};

const EXT_TO_KIND: Record<string, "PDF" | "DOCX" | "CSV" | "XLSX"> = {
  pdf: "PDF",
  docx: "DOCX",
  csv: "CSV",
  xlsx: "XLSX",
};

function detectKind(fileName: string, mimeType: string) {
  const byMime = MIME_TO_KIND[mimeType];
  if (byMime) return byMime;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_KIND[ext] ?? null;
}

const MAX_KNOWLEDGE_BYTES = 40 * 1024 * 1024;

const uploadSchema = z.object({
  title: z.string().min(2),
  /** Admin only: PRIVATE (with grants) or ORG (everyone). Employees forced PRIVATE+self. */
  visibility: z.enum(["PRIVATE", "ORG"]).default("PRIVATE"),
  /** Admin only: user IDs to grant read access (frontend expands a department to users). */
  grantUserIds: z.array(z.string().uuid()).default([]),
});

/**
 * Upload a knowledge-base document (tool record, BOM, operational doc, sheet).
 * Stores the file privately in S3, creates the row + access grants, and enqueues
 * ingestion. Dedupes by sha256 checksum (identical re-upload short-circuits).
 */
export async function uploadKnowledgeDocument(
  input: z.input<typeof uploadSchema>,
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<ActionResult<{ id: string }>> {
  if (!aiEnabled) {
    return fail(
      "The knowledge base is not enabled on this deployment. Contact an admin if you expected it to be available.",
    );
  }
  try {
    const user = await requireWritableUser();
    const data = uploadSchema.parse(input);
    const isAdmin = user.role === "ADMIN";

    const fileKind = detectKind(file.name, file.type);
    if (!fileKind) {
      return fail(
        "Unsupported file type. Upload a PDF, DOCX, CSV, or XLSX file and try again.",
      );
    }

    const visibility = isAdmin ? data.visibility : "PRIVATE";
    const ownerUserId = isAdmin ? null : user.id;
    const grantUserIds = isAdmin && visibility === "PRIVATE" ? data.grantUserIds : [];

    if (file.bytes.byteLength === 0) return fail("The file is empty.");
    if (file.bytes.byteLength > MAX_KNOWLEDGE_BYTES) {
      return fail(`File is too large (max ${MAX_KNOWLEDGE_BYTES / (1024 * 1024)} MB).`);
    }

    const buf = Buffer.from(file.bytes);
    const checksum = createHash("sha256").update(buf).digest("hex");

    const existing = await db.knowledgeDocument.findUnique({ where: { checksum } });
    if (existing) {
      if (grantUserIds.length) {
        await db.documentGrant.createMany({
          data: grantUserIds.map((uid) => ({
            documentId: existing.id,
            userId: uid,
            grantedById: user.id,
          })),
          skipDuplicates: true,
        });
      }
      await audit({
        action: "knowledge.upload_dedup",
        resource: `KnowledgeDocument:${existing.id}`,
        diff: { checksum, addedGrants: grantUserIds.length },
      });
      revalidatePath("/admin/knowledge");
      return ok({ id: existing.id });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    const path = `${checksum}.${ext}`;
    const { key } = await uploadFile("knowledge", path, file.bytes, { contentType: file.type });

    const doc = await db.knowledgeDocument.create({
      data: {
        title: data.title,
        sourceFilename: file.name,
        mimeType: file.type,
        fileKind,
        s3Key: key,
        checksum,
        uploadedById: user.id,
        ownerUserId,
        visibility,
        status: "QUEUED",
        grants: grantUserIds.length
          ? {
              create: grantUserIds.map((uid) => ({ userId: uid, grantedById: user.id })),
            }
          : undefined,
      },
    });

    await audit({
      action: "knowledge.upload",
      resource: `KnowledgeDocument:${doc.id}`,
      diff: { title: data.title, fileKind, visibility, grants: grantUserIds.length },
    });

    const enqueued = await enqueueOrMarkFailed(doc.id);

    revalidatePath("/admin/knowledge");
    revalidatePath("/dashboard/knowledge");
    if (!enqueued) {
      return fail(
        "The file was saved but processing could not be started (the processing queue is unavailable). An admin can retry it from the Knowledge base page.",
      );
    }
    return ok({ id: doc.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/**
 * Enqueue ingestion; if the queue is unreachable, mark the document FAILED with
 * a reason (instead of leaving it QUEUED forever) so it is visible and retryable.
 */
async function enqueueOrMarkFailed(documentId: string): Promise<boolean> {
  try {
    await enqueueIngestion(documentId);
    return true;
  } catch (e) {
    console.error("[knowledge] enqueue failed for", documentId, e);
    await db.knowledgeDocument
      .update({
        where: { id: documentId },
        data: {
          status: "FAILED",
          failureReason: "Could not start processing (queue unavailable). Use Retry.",
        },
      })
      .catch((e2) => console.error("[knowledge] could not mark FAILED", e2));
    return false;
  }
}

/** Retry ingestion of a FAILED (or stuck QUEUED) document (admin). */
export async function retryKnowledgeDocument(documentId: string): Promise<ActionResult> {
  if (!aiEnabled) return fail("The knowledge base is not enabled on this deployment.");
  try {
    const user = await requireUser();
    if (user.role !== "ADMIN") return fail("Only admins can retry document processing.");
    const doc = await db.knowledgeDocument.findUnique({
      where: { id: documentId },
      select: { id: true, status: true },
    });
    if (!doc) return fail("That document no longer exists.");
    if (doc.status === "READY") return fail("That document is already processed.");
    await db.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "QUEUED", failureReason: null },
    });
    const enqueued = await enqueueOrMarkFailed(documentId);
    await audit({
      action: "knowledge.retry",
      resource: `KnowledgeDocument:${documentId}`,
      diff: { previousStatus: doc.status, enqueued },
    });
    revalidatePath("/admin/knowledge");
    if (!enqueued) return fail("The processing queue is still unavailable. Try again shortly.");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Update grants for a document (admin). Frontend expands departments to user IDs. */
export async function setDocumentGrants(
  documentId: string,
  userIds: string[],
): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    return fail("Only admins can change knowledge document access. Ask an admin for help.");
  }

  try {
    await db.$transaction([
      db.documentGrant.deleteMany({ where: { documentId } }),
      db.documentGrant.createMany({
        data: userIds.map((uid) => ({ documentId, userId: uid, grantedById: user.id })),
        skipDuplicates: true,
      }),
    ]);

    await audit({
      action: "knowledge.set_grants",
      resource: `KnowledgeDocument:${documentId}`,
      diff: { grantCount: userIds.length },
    });
    revalidatePath("/admin/knowledge");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
