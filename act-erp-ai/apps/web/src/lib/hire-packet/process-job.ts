import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
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

import {
  encryptHirePacketFields,
  HIRE_PACKET_FAILURE_MESSAGE,
} from "@/server/hire-packet-sensitive-data";

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

/** Every stale takeover gets a new fence; old attempts cannot publish or fail it. */
async function claimJob(jobId: string): Promise<string | null> {
  const processingToken = randomUUID();
  const res = await db.hirePacketImport.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: "PENDING" },
        { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - HIRE_JOB_STALE_MS) } },
      ],
    },
    data: { status: "PROCESSING", processingToken, errorMessage: null },
  });
  return res.count === 1 ? processingToken : null;
}

async function heartbeat(jobId: string, processingToken: string): Promise<boolean> {
  const result = await db.hirePacketImport.updateMany({
    where: { id: jobId, status: "PROCESSING", processingToken },
    data: { errorMessage: null },
  });
  return result.count === 1;
}

class LostProcessingAttempt extends Error {}

/** Process an import with attempt-scoped staging and fenced publication. */
export async function processHirePacketJob(jobId: string): Promise<void> {
  const job = await db.hirePacketImport.findUnique({ where: { id: jobId } });
  if (!job || job.status === "APPLIED" || job.status === "CANCELLED" || job.status === "READY" || job.status === "FAILED") {
    return;
  }
  const processingToken = await claimJob(jobId);
  if (!processingToken) return;
  const stagedPaths: string[] = [];
  let published = false;

  try {
    const row = await db.hirePacketImport.findUnique({ where: { id: jobId } });
    if (!row || row.status !== "PROCESSING" || row.processingToken !== processingToken) return;
    const zipBuffer = await downloadZip(row.zipStorageKey);
    const entries = unzipHirePacket(zipBuffer);
    const fileResults: HirePacketFileResult[] = [];
    const proposalLayers: HirePacketProposals[] = [];
    const textParts: string[] = [];
    const documents: Prisma.DocumentCreateManyInput[] = [];

    for (const entry of entries) {
      if (!await heartbeat(jobId, processingToken)) throw new LostProcessingAttempt();
      const warnings: string[] = [];
      const valid = validateUpload("document", { name: entry.fileName, bytes: entry.bytes });
      if (!valid.ok) {
        fileResults.push({
          fileName: entry.fileName, documentId: null, formType: "UNKNOWN",
          textSource: "digital", warnings: [`Skipped: ${valid.error}`],
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
          warnings.push("OCR failed - file stored but fields not extracted.");
        }
      }
      if (!text.trim()) warnings.push("No readable text found.");
      textParts.push(text);
      const formType = classifyHireDocument(text, entry.fileName);
      proposalLayers.push(extractFromTemplate(text, entry.fileName, formType));

      const storagePath = `${row.employeeId}/hire-import/${jobId}/${processingToken}/${Date.now()}-${valid.safeFileName}`;
      // Remember the exact key even if PUT fails after reaching S3.
      stagedPaths.push(storagePath);
      await uploadFile("documents", storagePath, entry.bytes, { contentType });
      const documentId = randomUUID();
      // No employee-visible row exists until this attempt wins publication.
      documents.push({
        id: documentId,
        title: entry.fileName.replace(/\.[^.]+$/, ""),
        description: `Imported from hire packet ${row.zipFileName}`,
        fileName: storagePath, fileType: contentType, fileUrl: storagePath,
        documentType: documentTypeForForm(formType), employeeId: row.employeeId,
        uploadedById: row.uploadedById,
      });
      fileResults.push({ fileName: entry.fileName, documentId, formType, textSource, warnings });
    }
    if (!documents.length) throw new Error(HIRE_PACKET_FAILURE_MESSAGE);
    if (!await heartbeat(jobId, processingToken)) throw new LostProcessingAttempt();
    let proposedFields = mergeProposals(proposalLayers);
    proposedFields = await llmFillGaps(textParts.join("\n\n---\n\n"), proposedFields);
    const encrypted = await encryptHirePacketFields(jobId, { proposedFields, fileResults });

    const previousDocuments = await db.$transaction(async (tx) => {
      const won = await tx.hirePacketImport.updateMany({
        where: { id: jobId, status: "PROCESSING", processingToken },
        data: {
          status: "READY", processingToken: null, ...encrypted,
          errorMessage: null, processedAt: new Date(),
        },
      });
      if (won.count !== 1) return null;
      // Old releases published rows before processing finished. Remove only
      // the explicit old rows selected after this attempt wins the fence.
      const previous = await tx.document.findMany({
        where: {
          employeeId: row.employeeId,
          fileName: { contains: `/hire-import/${jobId}/` },
        },
        select: { id: true, fileName: true },
      });
      if (previous.length) {
        await tx.document.deleteMany({ where: { id: { in: previous.map(doc => doc.id) } } });
      }
      await tx.document.createMany({ data: documents });
      return previous;
    });
    if (previousDocuments === null) throw new LostProcessingAttempt();
    published = true;
    // A stale attempt can never reach this block after a newer one publishes.
    // Cleanup uses selected exact old keys, not a wildcard job folder.
    await Promise.all(previousDocuments.map(doc => deleteFile("documents", doc.fileName).catch(() => undefined)));
  } catch (error) {
    if (!(error instanceof LostProcessingAttempt)) {
      await db.hirePacketImport.updateMany({
        where: { id: jobId, status: "PROCESSING", processingToken },
        data: { status: "FAILED", processingToken: null, errorMessage: HIRE_PACKET_FAILURE_MESSAGE },
      });
      throw new Error(HIRE_PACKET_FAILURE_MESSAGE);
    }
  } finally {
    if (!published) {
      await Promise.all(stagedPaths.map(path => deleteFile("documents", path).catch(() => undefined)));
    }
  }
}

export async function claimAndProcessHirePacketJob(jobId: string): Promise<void> {
  await processHirePacketJob(jobId);
}
