import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { sqs } from "@/lib/aws";
import { env } from "@/lib/env";

/** Enqueue an ingestion job for the worker (apps/ai). */
export async function enqueueIngestion(documentId: string): Promise<void> {
  await sqs().send(
    new SendMessageCommand({
      QueueUrl: env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({ type: "ingest", document_id: documentId }),
    }),
  );
}
