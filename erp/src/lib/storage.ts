import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Storage abstraction. We use Supabase Storage (S3-compatible underneath).
 * If we ever swap to R2/S3, update this file — call sites stay the same.
 */
export type Bucket =
  | "profile-pics"
  | "documents"
  | "payroll"
  | "reimbursement-receipts"
  | "onboarding";

export async function uploadFile(
  bucket: Bucket,
  path: string,
  file: ArrayBuffer | Buffer | Blob,
  options: { contentType?: string; upsert?: boolean } = {},
) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: options.contentType,
    upsert: options.upsert ?? false,
    cacheControl: "3600",
  });
  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(path);

  return { path: data.path, publicUrl };
}

export async function deleteFile(bucket: Bucket, path: string) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}

export async function getSignedUrl(
  bucket: Bucket,
  path: string,
  expiresInSeconds = 3600,
) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
