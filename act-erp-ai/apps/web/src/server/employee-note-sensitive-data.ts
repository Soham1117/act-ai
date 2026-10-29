import "server-only";
import { z } from "zod";
import { decryptSensitiveText, encryptSensitiveText, isEncryptedSensitiveText, SensitiveDataError } from "./sensitive-data";

export const PRIVATE_NOTE_TITLE = "Private employee note";
export const PRIVATE_NOTE_REASON = "Private revision";
const contentSchema = z.object({
  title: z.string().max(160),
  body: z.string().max(12000),
  reason: z.string().nullable(),
});
export type EmployeeNoteContent = z.infer<typeof contentSchema>;

export function employeeNoteContext(id: string, revision = false) {
  return { purpose: revision ? "employee-note-revision" : "employee-note", recordId: id, field: "content" };
}

/** Title and revision reason can contain PII too: seal the complete content. */
export async function encryptEmployeeNoteContent(content: EmployeeNoteContent, id: string, revision = false) {
  const parsed = contentSchema.parse(content);
  return {
    title: PRIVATE_NOTE_TITLE,
    body: await encryptSensitiveText(JSON.stringify(parsed), employeeNoteContext(id, revision)),
    ...(revision ? { reason: PRIVATE_NOTE_REASON } : {}),
  };
}

/** Call after requireAdmin; decrypted content must never be passed to audit logs. */
export async function decryptEmployeeNoteContent<T extends { id: string; title: string; body: string; reason?: string | null }>(
  note: T,
  revision = false,
): Promise<T> {
  if (!isEncryptedSensitiveText(note.body)) {
    // Enforce strict-mode policy without making legacy freeform text look like
    // serialized JSON. Legacy title/body/reason remain available during backfill.
    await decryptSensitiveText(note.body, employeeNoteContext(note.id, revision));
    return note;
  }
  try {
    const decoded = contentSchema.parse(JSON.parse(await decryptSensitiveText(note.body, employeeNoteContext(note.id, revision))));
    return { ...note, title: decoded.title, body: decoded.body, ...(revision ? { reason: decoded.reason } : {}) };
  } catch {
    throw new SensitiveDataError();
  }
}
