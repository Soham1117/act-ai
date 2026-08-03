/**
 * Re-enqueue FAILED (or stuck QUEUED/PARSING/EMBEDDING) knowledge documents.
 *
 *   pnpm tsx --env-file=.env.local scripts/requeue-failed.ts
 *
 * Marker parses are cached in S3 by checksum, so re-ingestion skips Datalab and
 * goes straight to embedding + commit. Use after fixing an env problem (e.g. a
 * dead GEMINI_API_KEY).
 */
import { PrismaClient } from "@prisma/client";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const db = new PrismaClient();
const sqs = new SQSClient({
  region: process.env.AWS_REGION,
  ...(process.env.AWS_ENDPOINT_URL ? { endpoint: process.env.AWS_ENDPOINT_URL } : {}),
});

async function main() {
  const docs = await db.knowledgeDocument.findMany({
    where: { status: { in: ["FAILED", "QUEUED", "PARSING", "EMBEDDING"] } },
    select: { id: true, title: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  if (docs.length === 0) {
    console.log("Nothing to requeue — all documents are READY.");
    return;
  }
  for (const d of docs) {
    await db.knowledgeDocument.update({
      where: { id: d.id },
      data: { status: "QUEUED", failureReason: null },
    });
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.SQS_QUEUE_URL,
        MessageBody: JSON.stringify({ type: "ingest", document_id: d.id }),
      }),
    );
    console.log(`  requeued: ${d.title} (was ${d.status})`);
  }
  console.log(`Done. ${docs.length} document(s) requeued.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
