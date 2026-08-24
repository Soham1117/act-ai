import AdmZip from "adm-zip";
import { MAX_HIRE_ZIP_BYTES, MAX_HIRE_ZIP_FILES } from "@/lib/hire-packet/types";

const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

export type ZipEntry = {
  fileName: string;
  bytes: Buffer;
  contentType: string;
};

export function unzipHirePacket(buffer: Buffer): ZipEntry[] {
  if (buffer.byteLength > MAX_HIRE_ZIP_BYTES) {
    throw new Error(`Zip exceeds ${MAX_HIRE_ZIP_BYTES / (1024 * 1024)} MB limit.`);
  }
  const zip = new AdmZip(buffer);
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && !e.entryName.includes("__MACOSX") && !e.entryName.startsWith("."))
    .map((e) => ({
      fileName: e.entryName.split("/").pop() ?? e.entryName,
      bytes: e.getData(),
      contentType: contentTypeFor(e.entryName),
    }))
    .filter((e) => ALLOWED_EXT.has(extOf(e.fileName)));

  if (entries.length === 0) {
    throw new Error("Zip contains no supported files (PDF, JPG, PNG).");
  }
  if (entries.length > MAX_HIRE_ZIP_FILES) {
    throw new Error(`Zip contains more than ${MAX_HIRE_ZIP_FILES} files.`);
  }
  return entries;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

function contentTypeFor(name: string): string {
  const ext = extOf(name);
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  return "image/jpeg";
}
