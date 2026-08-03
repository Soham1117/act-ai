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
  | "onboarding"
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
  // Objects are private — a signed URL is the read path. Callers that persist
  // this should re-sign on read for long-lived access (see getSignedUrl).
  const publicUrl = await presign(
    s3(),
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    { expiresIn: 3600 },
  );
  return { path, key, publicUrl };
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
