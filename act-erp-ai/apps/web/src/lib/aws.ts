import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { env } from "@/lib/env";

/**
 * Shared AWS clients. In prod, credentials come from the task IAM role (default
 * provider chain). Locally, AWS_ENDPOINT_URL points at LocalStack/MinIO and
 * AWS_ACCESS_KEY_ID/SECRET come from env. `forcePathStyle` is required for
 * LocalStack/MinIO.
 */
const common = {
  region: env.AWS_REGION,
  ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
};

let _s3: S3Client | null = null;
export function s3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({ ...common, forcePathStyle: Boolean(env.AWS_ENDPOINT_URL) });
  }
  return _s3;
}

let _sqs: SQSClient | null = null;
export function sqs(): SQSClient {
  if (!_sqs) _sqs = new SQSClient(common);
  return _sqs;
}
