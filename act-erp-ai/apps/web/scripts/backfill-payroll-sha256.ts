/**
 * Backfill Payroll.fileSha256 for rows uploaded before duplicate detection
 * existed, so the duplicate-paystub guard also covers old uploads.
 *
 *   On the box (compose):
 *   docker compose -f docker-compose.prod-lite.yml run --rm tools tsx scripts/backfill-payroll-sha256.ts
 *   (local: pnpm tsx --env-file=.env.local scripts/backfill-payroll-sha256.ts)
 *
 * Idempotent: only touches rows where fileSha256 IS NULL; safe to re-run and
 * safe to interrupt. Rows whose object cannot be read are reported and left as-is.
 * Read-only against S3.
 */
import { createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  ...(process.env.AWS_ENDPOINT_URL ? { endpoint: process.env.AWS_ENDPOINT_URL, forcePathStyle: true } : {}),
});

async function sha256OfKey(key: string): Promise<string> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  const hash = createHash("sha256");
  for await (const chunk of obj.Body as AsyncIterable<Uint8Array>) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  if (!process.env.S3_BUCKET) throw new Error("S3_BUCKET is not set");
  const rows = await db.payroll.findMany({
    where: { fileSha256: null },
    select: { id: true, fileUrl: true, title: true },
    orderBy: { uploadedAt: "asc" },
  });
  console.log(`${rows.length} payroll row(s) without a checksum.`);
  let done = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const sha = await sha256OfKey(r.fileUrl);
      await db.payroll.updateMany({ where: { id: r.id, fileSha256: null }, data: { fileSha256: sha } });
      done++;
    } catch (e) {
      failed++;
      console.warn(`  skipped ${r.id} (${r.title}): ${(e as Error).message}`);
    }
  }
  console.log(`Done. updated=${done} skipped=${failed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
