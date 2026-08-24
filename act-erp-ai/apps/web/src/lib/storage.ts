import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import { s3 } from "@/lib/aws";
import { env } from "@/lib/env";

/**
 * Storage abstraction over a single S3 bucket. The legacy "bucket" names are now
 * key prefixes within env.S3_BUCKET, so existing call sites keep the same API.
 *
 * Migrated off Supabase Storage (Phase 3). All objects are private; reads go
 * through short-lived signed URLs (`getSignedUrl`). Knowledge-base documents use
 * the same private storage via the dedicated helpers below.
 */
export type Bucket =
  | "profile-pics"
  | "documents"
  | "payroll"
  | "reimbursement-receipts"
  | "knowledge";

function keyFor(bucket: Bucket, path: string): string {
  return `${bucket}/${path}`;
}

export async function uploadFile(
  bucket: Bucket,
  path: string,
  file: ArrayBuffer | Buffer | Blob,
  options: { contentType?: string; upsert?: boolean } = {},
) {
  const key = keyFor(bucket, path);
  const body =
    file instanceof Blob ? Buffer.from(await file.arrayBuffer()) : Buffer.from(file as ArrayBuffer);
  await s3().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      CacheControl: "3600",
    }),
  );
  // Objects are private. Do NOT persist a presigned URL anywhere (DB, logs) —
  // it's a bearer credential with no session/auth check while valid, and it
  // goes stale (default 1h) long before most records are read again. Reads
  // must go through an authenticated proxy route that re-checks access on
  // every request (see getObjectStream + the /api/*/file routes).
  return { path, key };
}

export async function deleteFile(bucket: Bucket, path: string) {
  await s3().send(
    new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: keyFor(bucket, path) }),
  );
}

export async function getSignedUrl(
  bucket: Bucket,
  path: string,
  expiresInSeconds = 3600,
) {
  return presign(
    s3(),
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: keyFor(bucket, path) }),
    { expiresIn: expiresInSeconds },
  );
}

/** Raw key signing — used by the knowledge base where we store the S3 key directly. */
export function signedUrlForKey(key: string, expiresInSeconds = 3600) {
  return presign(
    s3(),
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/** Stream an object by raw key — used to proxy files same-origin (browser fetches
 *  to S3/LocalStack would need CORS; proxying through the app avoids it and keeps
 *  every read behind the caller's auth check). */
export async function getObjectStream(key: string) {
  const obj = await s3().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  return {
    stream: obj.Body!.transformToWebStream(),
    contentType: obj.ContentType ?? "application/octet-stream",
    contentLength: obj.ContentLength,
  };
}
