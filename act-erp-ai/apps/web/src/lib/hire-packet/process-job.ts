import { db } from "@/lib/db";
import { uploadFile, deleteFile, getObjectStream } from "@/lib/storage";
import { validateUpload } from "@/lib/upload-validation";
import { classifyHireDocument } from "@/lib/hire-packet/extract/classify";
import { extractPdfText } from "@/lib/hire-packet/extract/pdf-text";
import { textractText } from "@/lib/hire-packet/extract/textract";
import { extractFromTemplate, mergeProposals } from "@/lib/hire-packet/extract/templates";
import { llmFillGaps } from "@/lib/hire-packet/extract/llm";
import { unzipHirePacket } from "@/lib/hire-packet/zip";
import {
  HIRE_JOB_STALE_MS,
  MIN_DIGITAL_TEXT_CHARS,
  type HirePacketFileResult,
  type HirePacketProposals,
} from "@/lib/hire-packet/types";

function documentTypeForForm(
  form: ReturnType<typeof classifyHireDocument>,
): "ONBOARDING" | "PERSONAL" | "BENEFITS" | "TRAINING" | "COMPANY" {
  if (form === "DIRECT_DEPOSIT") return "PERSONAL";
  return "ONBOARDING";
}

async function downloadZip(key: string): Promise<Buffer> {
  const { stream } = await getObjectStream(`documents/${key}`);
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Remove documents created by an earlier (failed / abandoned) run of this job
 * so a retry never duplicates them. Matches on the per-job storage folder.
 */
async function cleanupJobDocuments(jobId: string, employeeId: string): Promise<void> {
  const docs = await db.document.findMany({
    where: { employeeId, fileName: { contains: `/hire-import/${jobId}/` } },
    select: { id: true, fileName: true },
  });
  if (docs.length === 0) return;
  await db.document.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } });
  await Promise.all(docs.map((d) => deleteFile("documents", d.fileName).catch(() => undefined)));
}

/**
 * Atomically claim a job for processing: PENDING, or PROCESSING that has not
 * been touched for HIRE_JOB_STALE_MS (the worker died mid-run). Only one
 * caller can win.
 */
async function claimJob(jobId: string): Promise<boolean> {
  const res = await db.hirePacketImport.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "PENDING" },
        { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - HIRE_JOB_STALE_MS) } },
      ],
    },
    data: { status: "PROCESSING", errorMessage: null },
  });
  return res.count === 1;
}

/** Keep updatedAt fresh so a long-running job isn't mistaken for a dead one. */
async function heartbeat(jobId: string): Promise<void> {
  await db.hirePacketImport
    .updateMany({ where: { id: jobId, status: "PROCESSING" }, data: { errorMessage: null } })
    .catch(() => undefined);
}

/** Process a hire-packet import job. Idempotent — skips finished jobs. */
export async function processHirePacketJob(jobId: string): Promise<void> {
  const job = await db.hirePacketImport.findUnique({ where: { id: jobId } });
  if (!job || job.status === "APPLIED" || job.status === "CANCELLED" || job.status === "READY" || job.status === "FAILED") {
    return;
  }
  if (!(await claimJob(jobId))) return;
  // A previous attempt may have left documents behind.
  await cleanupJobDocuments(jobId, job.employeeId);

  try {
    const row = await db.hirePacketImport.findUnique({ where: { id: jobId } });
    if (!row) return;

    const zipBuffer = await downloadZip(row.zipStorageKey);
    const entries = unzipHirePacket(zipBuffer);
    const fileResults: HirePacketFileResult[] = [];
    const proposalLayers: HirePacketProposals[] = [];
    const textParts: string[] = [];

    for (const entry of entries) {
      await heartbeat(jobId);
      const warnings: string[] = [];
      // Never trust the extension alone: check magic bytes and size.
      const valid = validateUpload("document", { name: entry.fileName, bytes: entry.bytes });
      if (!valid.ok) {
        fileResults.push({
          fileName: entry.fileName,
          documentId: null,
          formType: "UNKNOWN",
          textSource: "digital",
          warnings: [`Skipped: ${valid.error}`],
        });
        continue;
      }
      const contentType = valid.contentType;
      let text = "";
      let textSource: "digital" | "textract" = "digital";

      if (contentType === "application/pdf") {
        text = await extractPdfText(
          entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength) as ArrayBuffer,
        );
      }

      if (text.trim().length < MIN_DIGITAL_TEXT_CHARS) {
        try {
          text = await textractText(entry.bytes, contentType);
          textSource = "textract";
        } catch {
          warnings.push("OCR failed — file stored but fields not extracted.");
        }
      }

      if (!text.trim()) warnings.push("No readable text found.");

      textParts.push(text);
      const formType = classifyHireDocument(text, entry.fileName);
      proposalLayers.push(extractFromTemplate(text, entry.fileName, formType));

      const storagePath = `${row.employeeId}/hire-import/${jobId}/${Date.now()}-${valid.safeFileName}`;
      await uploadFile("documents", storagePath, entry.bytes, { contentType });

      const doc = await db.document.create({
        data: {
          title: entry.fileName.replace(/\.[^.]+$/, ""),
          description: `Imported from hire packet ${row.zipFileName}`,
          fileName: storagePath,
          fileType: contentType,
          fileUrl: storagePath,
          documentType: documentTypeForForm(formType),
          employeeId: row.employeeId,
          uploadedById: row.uploadedById,
        },
      });

      fileResults.push({
        fileName: entry.fileName,
        documentId: doc.id,
        formType,
        textSource,
        warnings,
      });
    }

    if (!fileResults.some((f) => f.documentId)) {
      throw new Error(
        `None of the files in the zip could be imported. ${fileResults
          .flatMap((f) => f.warnings.map((w) => `${f.fileName}: ${w}`))
          .join(" ")}`.trim(),
      );
    }

    let proposedFields = mergeProposals(proposalLayers);
    proposedFields = await llmFillGaps(textParts.join("\n\n---\n\n"), proposedFields);

    await db.hirePacketImport.update({
      where: { id: jobId },
      data: {
        status: "READY",
        proposedFields,
        fileResults,
        processedAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed";
    await db.hirePacketImport.update({
      where: { id: jobId },
      data: { status: "FAILED", errorMessage: message },
    });
    // Don't leave half-imported documents on the employee's record.
    await cleanupJobDocuments(jobId, job.employeeId).catch(() => undefined);
    throw err;
  }
}

export async function claimAndProcessHirePacketJob(jobId: string): Promise<void> {
  await processHirePacketJob(jobId);
}
