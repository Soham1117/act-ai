import { db } from "@/lib/db";
import { uploadFile, getObjectStream } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { classifyHireDocument } from "@/lib/hire-packet/extract/classify";
import { extractPdfText } from "@/lib/hire-packet/extract/pdf-text";
import { textractText } from "@/lib/hire-packet/extract/textract";
import { extractFromTemplate, mergeProposals } from "@/lib/hire-packet/extract/templates";
import { llmFillGaps } from "@/lib/hire-packet/extract/llm";
import { unzipHirePacket } from "@/lib/hire-packet/zip";
import {
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

/** Process a hire-packet import job. Idempotent — skips completed jobs. */
export async function processHirePacketJob(jobId: string): Promise<void> {
  const job = await db.hirePacketImport.findUnique({ where: { id: jobId } });
  if (!job || job.status === "APPLIED" || job.status === "CANCELLED" || job.status === "READY" || job.status === "FAILED") {
    return;
  }

  if (job.status === "PENDING") {
    const claimed = await db.hirePacketImport.updateMany({
      where: { id: jobId, status: "PENDING" },
      data: { status: "PROCESSING", errorMessage: null },
    });
    if (claimed.count === 0) return;
  } else {
    await db.hirePacketImport.update({
      where: { id: jobId },
      data: { status: "PROCESSING", errorMessage: null },
    });
  }

  try {
    const row = await db.hirePacketImport.findUnique({ where: { id: jobId } });
    if (!row) return;

    const zipBuffer = await downloadZip(row.zipStorageKey);
    const entries = unzipHirePacket(zipBuffer);
    const fileResults: HirePacketFileResult[] = [];
    const proposalLayers: HirePacketProposals[] = [];
    const textParts: string[] = [];

    for (const entry of entries) {
      const warnings: string[] = [];
      let text = "";
      let textSource: "digital" | "textract" = "digital";

      if (entry.contentType === "application/pdf") {
        text = await extractPdfText(
          entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength) as ArrayBuffer,
        );
      }

      if (text.trim().length < MIN_DIGITAL_TEXT_CHARS) {
        try {
          text = await textractText(entry.bytes, entry.contentType);
          textSource = "textract";
        } catch {
          warnings.push("OCR failed — file stored but fields not extracted.");
        }
      }

      if (!text.trim()) warnings.push("No readable text found.");

      textParts.push(text);
      const formType = classifyHireDocument(text, entry.fileName);
      proposalLayers.push(extractFromTemplate(text, entry.fileName, formType));

      const storagePath = `${row.employeeId}/hire-import/${jobId}/${Date.now()}-${entry.fileName}`;
      await uploadFile("documents", storagePath, entry.bytes, { contentType: entry.contentType });

      const doc = await db.document.create({
        data: {
          title: entry.fileName.replace(/\.[^.]+$/, ""),
          description: `Imported from hire packet ${row.zipFileName}`,
          fileName: storagePath,
          fileType: entry.contentType,
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
    throw err;
  }
}

export async function claimAndProcessHirePacketJob(jobId: string): Promise<void> {
  await processHirePacketJob(jobId);
}
