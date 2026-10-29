import { createHash, createHmac } from "node:crypto";
import { PDFDocument, PDFName } from "pdf-lib";
import { DetectDocumentTextCommand, TextractClient } from "@aws-sdk/client-textract";
import { analyzePaystubPdf, classifyPaystubRows } from "@/lib/paystub-parser";
import { matchEmployee } from "@/lib/paystub-match";
import { validateUpload } from "@/lib/upload-validation";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { readEmployeePrivateDetails } from "@/server/employee-private-data";
import type { BatchPreview, BatchPage } from "@/lib/paystub-import";
import { payrollVersion } from "./paystub-persistence";

export type SourceFile = { name: string; type: string; bytes: ArrayBuffer };
export function sourcePageKey(hash: string, page: number): string { return createHash("sha256").update(`paystub-v1:${hash}:${page}`).digest("hex"); }
export async function splitPaystubPage(source: PDFDocument, pageNumber: number): Promise<ArrayBuffer> {
  const fragment = await PDFDocument.create();
  // Strip links, embedded files, scripts and page metadata before copying:
  // annotations can otherwise pull another employee's page into copied objects.
  const originalPage = source.getPage(pageNumber - 1);
  for (const key of ["Annots", "AA", "Metadata", "PieceInfo", "AF", "PresSteps"]) originalPage.node.delete(PDFName.of(key));
  const [page] = await fragment.copyPages(source, [pageNumber - 1]);
  fragment.addPage(page);
  const bytes = await fragment.save();
  return Uint8Array.from(bytes).buffer;
}
export function semanticPaystubHash(page: Pick<BatchPage, "parsed">): string | null {
  const p = page.parsed;
  if (!p?.checkNumber || !p.employeeName || !p.payPeriodStart || !p.payPeriodEnd) return null;
  return createHash("sha256").update(JSON.stringify([p.employeeName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(), p.ssnLast4, p.payPeriodStart, p.payPeriodEnd, p.payDate, p.checkNumber])).digest("hex");
}

/** No source is stored during analysis. OCR is opt-in and limited to scanned pages. */
export async function analyzePayrollSource(file: SourceFile, ocr = false): Promise<BatchPreview> {
  const validation = validateUpload("paystub", file);
  if (!validation.ok) throw new Error(validation.error);
  const analyzed = await analyzePaystubPdf(file.bytes);
  const scanned = analyzed.pages.filter((page) => page.status === "OCR_REQUIRED");
  const extraction = new Set<number>();
  if (ocr && scanned.length) {
    if (scanned.length > 10) throw new Error("OCR supports up to 10 scanned pages per review. Split this source into smaller files and try again.");
    const source = await PDFDocument.load(file.bytes);
    const client = new TextractClient({ region: env.AWS_REGION, ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}), maxAttempts: 2 });
    try {
      for (const page of scanned) {
        const bytes = await splitPaystubPage(source, page.pageNumber);
        let response;
        try { response = await client.send(new DetectDocumentTextCommand({ Document: { Bytes: new Uint8Array(bytes) } }), { abortSignal: AbortSignal.timeout(25000) }); }
        catch { throw new Error("OCR is unavailable or this scan could not be read. Check Textract access, or upload a searchable PDF. No documents were saved."); }
        const lines = (response.Blocks ?? []).filter((block) => block.BlockType === "LINE" && block.Text);
        const rows = lines.map((line) => ({ y: Math.round((1 - (line.Geometry?.BoundingBox?.Top ?? 0)) * 1000), text: line.Text! }));
        const classified = classifyPaystubRows(rows);
        if (lines.some((line) => (line.Confidence ?? 0) < 90)) {
          Object.assign(page, { status: "UNSUPPORTED", reason: "OCR confidence is too low for safe employee separation. Upload a clearer searchable PDF.", parsed: null });
        } else Object.assign(page, classified);
        extraction.add(page.pageNumber);
      }
    } finally { client.destroy(); }
  }
  const storedRoster = await db.employee.findMany({ where: { employmentStatus: { not: "PENDING_REVIEW" } }, select: { id: true, name: true, ssnLast4: true, privateDetails: true, employmentStatus: true }, orderBy: { id: "asc" } });
  const rosterHash = createHash("sha256").update(JSON.stringify(storedRoster)).digest("hex");
  const roster = await Promise.all(storedRoster.map(async row => ({
    id: row.id, name: row.name, ssnLast4: (await readEmployeePrivateDetails(row)).ssnLast4, employmentStatus: row.employmentStatus,
  })));
  const pages: BatchPage[] = [];
  for (const page of analyzed.pages) {
    const match = page.parsed && page.status === "SUPPORTED" ? matchEmployee(page.parsed, roster) : { employeeId: null, confidence: "none" as const, reason: page.reason ?? "This page cannot be distributed.", nameOk: false, ssnOk: false };
    const importKey = sourcePageKey(validation.sha256, page.pageNumber);
    const semanticHash = semanticPaystubHash(page);
    const existing = await db.payroll.findMany({ where: { OR: [
      { importKey },
      ...(semanticHash ? [{ semanticHash }] : []),
      ...(analyzed.pageCount === 1 ? [{ fileSha256: validation.sha256 }] : []),
      ...(page.parsed?.payPeriodEnd ? [{ category: "Pay Stub", payPeriodEnd: new Date(page.parsed.payPeriodEnd + "T00:00:00Z") }] : []),
    ] }, orderBy: { id: "asc" }, take: 501 });
    if (existing.length > 500) throw new Error("This period has too many existing documents for one review. Ask an administrator to resolve the duplicate records first.");
    const duplicates = existing.map((row) => ({ id: row.id, title: row.title, employeeId: row.employeeId, payPeriodStart: row.payPeriodStart.toISOString().slice(0, 10), payPeriodEnd: row.payPeriodEnd.toISOString().slice(0, 10), version: payrollVersion(row), exact: row.importKey === importKey }));
    // Duplicate decisions are validated again under the write lock. They are
    // intentionally excluded here: saving one source must not invalidate the
    // next source's review merely because another employee received a stub.
    const tokenData = [validation.sha256, page.pageNumber, page.status, page.parsed, rosterHash];
    const reviewToken = createHmac("sha256", env.AUTH_SECRET).update(JSON.stringify(tokenData)).digest("hex");
    // Amounts are not needed for distribution and are never returned to the grid.
    pages.push({ ...page, parsed: page.parsed ? { ...page.parsed, netPay: null } : null, match, reviewToken, duplicates, extraction: extraction.has(page.pageNumber) ? "OCR" : "TEXT" });
  }
  return { sourceHash: validation.sha256, pageCount: analyzed.pageCount, pages, rosterHash };
}
