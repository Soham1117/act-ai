import { downloadHeaders, extOf } from "@/lib/upload-validation";
import { getObjectStream } from "@/lib/storage";

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/zip": "zip",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/** Name shown to the user: a human title plus the REAL extension of the stored object. */
export function displayFileName(
  title: string,
  storedName: string,
  fileType?: string | null,
): string {
  const ext =
    extOf(storedName) || MIME_EXT[(fileType ?? "").split(";")[0]!.trim().toLowerCase()] || "";
  const base = title.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  return ext ? `${base}.${ext}` : base;
}

/**
 * Stream a stored object with hardened headers (fixed content type from the
 * extension allowlist, nosniff, sandbox CSP). `download=1` forces attachment.
 */
export async function storedFileResponse(args: {
  req: Request;
  key: string;
  title: string;
  storedName: string;
  fileType?: string | null;
  cache?: string;
}): Promise<Response> {
  const download = new URL(args.req.url).searchParams.get("download") === "1";
  try {
    const { stream, contentLength } = await getObjectStream(args.key);
    const headers = downloadHeaders({
      fileName: displayFileName(args.title, args.storedName, args.fileType),
      fileType: args.fileType,
      inline: !download,
    });
    if (args.cache) headers["Cache-Control"] = args.cache;
    if (contentLength) headers["Content-Length"] = String(contentLength);
    return new Response(stream, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
