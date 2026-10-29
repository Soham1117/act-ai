/**
 * Import reviewed local source files into the PRIVATE company library as drafts.
 * Never publishes a template, creates an employee, or changes attendance.
 * Dry run unless --apply is supplied. Manifest paths are confined to --root.
 * Usage: tsx scripts/import-hr-library.ts --root /import/hr --actor admin@company --apply
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../src/lib/db";
import { uploadFile, deleteFile } from "../src/lib/storage";
import { validateUpload } from "../src/lib/upload-validation";
import { companyDocumentSchema } from "../src/lib/company-documents";

const option = (key: string) => process.argv[process.argv.indexOf(key) + 1];
const rootArg = process.argv.includes("--root") ? option("--root") : null;
const actorArg = process.argv.includes("--actor") ? option("--actor") : null;
const apply = process.argv.includes("--apply");
const manifestSchema = z.array(z.object({
  path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  metadata: companyDocumentSchema,
})).max(100);

async function main() {
  if (!rootArg || !actorArg) throw new Error("Provide --root and --actor. Dry run is the default; add --apply to import drafts.");
  const root = path.resolve(rootArg);
  const actor = await db.user.findFirst({where: {email: actorArg, role: "ADMIN"}, select: {id: true, email: true}});
  if (!actor) throw new Error("The explicit import actor must be an existing administrator.");
  const entries = manifestSchema.parse(JSON.parse(await readFile(path.join(root, "import-manifest.json"), "utf8")));
  let imported = 0, skipped = 0;
  // Validate the entire bounded manifest before uploading any objects.
  const checked = [];
  for (const entry of entries) {
    if (entry.metadata.documentId) throw new Error("This import only creates new private draft documents.");
    const target = path.resolve(root, entry.path);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("A source path leaves the import directory.");
    const bytes = await readFile(target);
    const validation = validateUpload("document", {name: path.basename(target), bytes});
    if (!validation.ok || validation.sha256 !== entry.sha256) throw new Error("A source file failed type, size, or SHA-256 validation.");
    checked.push({entry, bytes, validation});
  }
  for (const {entry, bytes, validation} of checked) {
    const existing = await db.companyDocumentVersion.findUnique({where: {sha256: validation.sha256}, select: {id: true}});
    if (existing) {skipped++; continue;}
    if (!apply) continue;
    const id = randomUUID();
    const versionId = randomUUID();
    const fileName = `company-library/${id}/${versionId}/${validation.safeFileName}`;
    await uploadFile("documents", fileName, bytes, {contentType: validation.contentType});
    try {
      const m = entry.metadata;
      await db.$transaction(async (tx) => {
        await tx.companyDocument.create({data: {id, title: m.title, category: m.category, issuer: m.issuer || null, createdById: actor.id}});
        await tx.companyDocumentVersion.create({data: {
          id: versionId, documentId: id, version: 1, originalName: path.basename(entry.path), fileName,
          fileType: validation.contentType, sha256: validation.sha256, sizeBytes: bytes.length,
          purpose: "HR_ONLY", status: "DRAFT", year: m.year, quarter: m.quarter,
          periodStart: m.periodStart ? new Date(`${m.periodStart}T00:00:00Z`) : null,
          periodEnd: m.periodEnd ? new Date(`${m.periodEnd}T00:00:00Z`) : null,
          effectiveDate: m.effectiveDate ? new Date(`${m.effectiveDate}T00:00:00Z`) : null,
          sourceReference: m.sourceReference || null, notes: m.notes || null, createdById: actor.id,
        }});
        await tx.auditLog.create({data: {actorId: actor.id, actorEmail: actor.email, action: "company.document.import_draft", resource: `CompanyDocumentVersion:${versionId}`, diff: {source: "HR supplied archive; explicit administrative CLI import", sha256: validation.sha256, category: m.category}}});
      });
      imported++;
    } catch (error) {
      await deleteFile("documents", fileName).catch(() => console.error("Staged import-object cleanup needs review."));
      throw error;
    }
  }
  console.log(JSON.stringify({mode: apply ? "apply-private-drafts" : "dry-run", validated: checked.length, imported, skipped, ready: checked.length - skipped}));
}
main().catch((error) => {console.error(error instanceof Error ? error.message : "HR draft import failed"); process.exitCode = 1;}).finally(() => db.$disconnect());
