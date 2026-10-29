import { z } from "zod";
import { parseDateOnly } from "@/lib/time-rules";

export const EMPLOYEE_NOTE_KINDS = ["GENERAL", "TERMINATION", "RESIGNATION"] as const;
export const EMPLOYEE_NOTE_LABELS: Record<string, string> = { GENERAL: "General", TERMINATION: "Termination", RESIGNATION: "Resignation" };
export const employeeNoteFields = z.object({
  title: z.string().trim().min(2, "Enter a title (at least 2 characters).").max(160),
  body: z.string().trim().min(1, "Enter the note.").max(12000),
  kind: z.enum(EMPLOYEE_NOTE_KINDS),
  noteDate: z.string().refine((value) => parseDateOnly(value) !== null, "Enter a valid note date (YYYY-MM-DD)."),
});

export function assertNoteRevision(note: { updatedAt: Date; isArchived: boolean }, expectedUpdatedAt: string): void {
  if (note.isArchived) throw new Error("This note is archived. Its history remains available.");
  if (note.updatedAt.toISOString() !== expectedUpdatedAt) throw new Error("This note changed. Refresh before saving your changes.");
}
