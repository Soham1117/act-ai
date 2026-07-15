/**
 * Bulk-upload knowledge documents (PDF/DOCX/CSV/XLSX) from local paths.
 *
 *   pnpm tsx --env-file=.env.local scripts/upload-knowledge.ts <file-or-dir> [...]
 *
 * Mirrors the uploadKnowledgeDocument server action: sha256 dedup → S3 →
 * KnowledgeDocument row (visibility ORG, uploaded by the first admin) → SQS
 * ingestion job. Idempotent: identical bytes are skipped.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const KIND_BY_EXT: Record<string, { kind: "PDF" | "DOCX" | "CSV" | "XLSX"; mime: string }> = {
  ".pdf": { kind: "PDF", mime: "application/pdf" },
  ".docx": { kind: "DOCX", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ".csv": { kind: "CSV", mime: "text/csv" },
  ".xlsx": { kind: "XLSX", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
};

const db = new PrismaClient();
const aws = {
  region: process.env.AWS_REGION,
  ...(process.env.AWS_ENDPOINT_URL ? { endpoint: process.env.AWS_ENDPOINT_URL } : {}),
};
const s3 = new S3Client({ ...aws, forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL) });
const sqs = new SQSClient(aws);

function titleFromFilename(name: string): string {
  return name
    .replace(extname(name), "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function expand(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const p of paths) {
    const s = await stat(p);
    if (s.isDirectory()) {
      for (const f of await readdir(p)) {
        if (KIND_BY_EXT[extname(f).toLowerCase()]) files.push(join(p, f));
      }
    } else {
      files.push(p);
    }
  }
  return files.sort();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: tsx scripts/upload-knowledge.ts <file-or-dir> [...]");
    process.exit(1);
  }

  const admin = await db.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("no ADMIN user found — create one with scripts/create-admin.ts");

  const files = await expand(args);
  console.log(`Uploading ${files.length} file(s) as ${admin.email} (visibility ORG)…`);

  let uploaded = 0;
  let skipped = 0;
  for (const file of files) {
    const meta = KIND_BY_EXT[extname(file).toLowerCase()];
    if (!meta) {
      console.warn(`  skip (unsupported): ${file}`);
      continue;
    }
    const buf = await readFile(file);
    const checksum = createHash("sha256").update(buf).digest("hex");

    const existing = await db.knowledgeDocument.findUnique({ where: { checksum } });
    if (existing) {
      skipped++;
      console.log(`  dedup: ${basename(file)} → ${existing.id} (${existing.status})`);
      continue;
    }

    const key = `knowledge/${checksum}${extname(file).toLowerCase()}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: buf,
        ContentType: meta.mime,
      }),
    );

    const doc = await db.knowledgeDocument.create({
      data: {
        title: titleFromFilename(basename(file)),
        sourceFilename: basename(file),
        mimeType: meta.mime,
        fileKind: meta.kind,
        s3Key: key,
        checksum,
        uploadedById: admin.id,
        visibility: "ORG",
        status: "QUEUED",
      },
    });

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.SQS_QUEUE_URL,
        MessageBody: JSON.stringify({ type: "ingest", document_id: doc.id }),
      }),
    );

    uploaded++;
    console.log(`  queued: ${basename(file)} → ${doc.id}`);
  }

  console.log(`Done. ${uploaded} queued, ${skipped} deduped. The worker ingests in the background.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
