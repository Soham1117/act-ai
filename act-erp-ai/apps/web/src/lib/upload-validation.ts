/**
 * Server-side upload validation. Never trust the client's file.type or name.
 * Files are checked by extension allowlist AND magic bytes, size-capped, and
 * given a server-chosen content type so a file can never be served as HTML/SVG
 * from the app origin.
 */
import { createHash } from "node:crypto";

export type UploadKind = "document" | "image" | "receipt" | "paystub" | "zip";

type Spec = { exts: string[]; maxBytes: number };

const MB = 1024 * 1024;

export const UPLOAD_SPECS: Record<UploadKind, Spec> = {
  document: { exts: ["pdf", "png", "jpg", "jpeg", "docx", "xlsx", "txt"], maxBytes: 15 * MB },
  image: { exts: ["png", "jpg", "jpeg", "webp"], maxBytes: 5 * MB },
  receipt: { exts: ["pdf", "png", "jpg", "jpeg"], maxBytes: 8 * MB },
  paystub: { exts: ["pdf"], maxBytes: 10 * MB },
  zip: { exts: ["zip"], maxBytes: 50 * MB },
};

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain; charset=utf-8",
};

function startsWith(buf: Uint8Array, sig: number[], offset = 0) {
  return sig.every((b, i) => buf[offset + i] === b);
}

/** Does the content match the claimed extension? */
function magicMatches(ext: string, b: Uint8Array): boolean {
  switch (ext) {
    case "pdf":
      // %PDF within the first 1 KB (some producers prepend whitespace).
      return Buffer.from(b.subarray(0, 1024)).includes("%PDF-");
    case "png":
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case "webp":
      return startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8);
    case "zip":
    case "docx":
    case "xlsx":
      return startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]);
    case "txt": {
      // Reject anything with NUL bytes or an HTML/script sniff.
      const head = Buffer.from(b.subarray(0, 2048));
      if (head.includes(0)) return false;
      return !/<\s*(html|script|svg|iframe)/i.test(head.toString("utf8"));
    }
    default:
      return false;
  }
}

export type ValidatedUpload = {
  ok: true;
  ext: string;
  contentType: string;
  /** Sanitized base name (no path, no extension). */
  baseName: string;
  /** baseName + "." + ext — safe to store and use in Content-Disposition. */
  safeFileName: string;
  sha256: string;
  size: number;
};

export type UploadError = { ok: false; error: string };

export function sanitizeBaseName(name: string): string {
  const base = name.replace(/\.[^.]*$/, "");
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[_ .-]+|[_ .-]+$/g, "")
    .slice(0, 80);
  return cleaned || "file";
}

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "";
}

export function validateUpload(
  kind: UploadKind,
  file: { name: string; bytes: Uint8Array | ArrayBuffer },
): ValidatedUpload | UploadError {
  const spec = UPLOAD_SPECS[kind];
  const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
  if (bytes.byteLength === 0) return { ok: false, error: "The file is empty." };
  if (bytes.byteLength > spec.maxBytes) {
    return {
      ok: false,
      error: `File is too large (max ${Math.round(spec.maxBytes / MB)} MB).`,
    };
  }
  const ext = extOf(file.name);
  if (!spec.exts.includes(ext)) {
    return {
      ok: false,
      error: `Unsupported file type. Allowed: ${spec.exts.map((e) => e.toUpperCase()).join(", ")}.`,
    };
  }
  if (!magicMatches(ext, bytes)) {
    return { ok: false, error: "The file contents don't match its type. Re-export it and try again." };
  }
  const baseName = sanitizeBaseName(file.name);
  return {
    ok: true,
    ext,
    contentType: CONTENT_TYPES[ext]!,
    baseName,
    safeFileName: `${baseName}.${ext}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
}

/**
 * Headers for serving a stored file. Always downloads/inline-safe: a fixed
 * content type from the extension allowlist, nosniff, and a sandboxing CSP so
 * even a mislabelled file cannot run script in the app origin.
 */
export function downloadHeaders(opts: {
  fileName: string;
  fileType?: string | null;
  inline?: boolean;
}): Record<string, string> {
  const ext = extOf(opts.fileName) || (opts.fileType ? extOf(`x.${opts.fileType}`) : "");
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const inlineOk = opts.inline && ["pdf", "png", "jpg", "jpeg", "webp"].includes(ext);
  const safeName = `${sanitizeBaseName(opts.fileName)}${ext ? `.${ext}` : ""}`;
  return {
    "Content-Type": contentType,
    "Content-Disposition": `${inlineOk ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    "Cache-Control": "private, no-store",
  };
}
