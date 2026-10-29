"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { failFromUnknown, ok, type ActionResult } from "@/lib/action-result";
import { assertNoteRevision, employeeNoteFields } from "@/lib/employee-notes";
import { parseDateOnly } from "@/lib/time-rules";
import { decryptEmployeeNoteContent, encryptEmployeeNoteContent } from "@/server/employee-note-sensitive-data";

export type EmployeeNoteView = {
  id: string; title: string; body: string; kind: string; noteDate: string;
  createdAt: string; updatedAt: string; createdByName: string; isArchived: boolean;
  revisions: Array<{ id: string; title: string; body: string; kind: string; noteDate: string; createdAt: string; actorName: string; reason: string | null }>;
};

export async function getEmployeeNotes(employeeId: string): Promise<ActionResult<{ notes: EmployeeNoteView[] }>> {
  await requireAdmin();
  try {
    const id = z.string().min(1).parse(employeeId);
    const storedNotes = await db.employeeNote.findMany({ where: { employeeId: id }, include: { revisions: { orderBy: { createdAt: "desc" } } }, orderBy: [{ noteDate: "desc" }, { createdAt: "desc" }] });
    const notes = await Promise.all(storedNotes.map(async (note) => ({
      ...await decryptEmployeeNoteContent(note),
      revisions: await Promise.all(note.revisions.map((revision) => decryptEmployeeNoteContent(revision, true))),
    })));
    const actorIds = [...new Set(notes.flatMap((note) => [note.createdById, ...note.revisions.map((revision) => revision.actorId)]))];
    const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
    const names = new Map(actors.map((actor) => [actor.id, actor.name]));
    return ok({ notes: notes.map((note) => ({
      id: note.id, title: note.title, body: note.body, kind: note.kind, noteDate: note.noteDate.toISOString().slice(0, 10),
      createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString(), isArchived: note.isArchived, createdByName: names.get(note.createdById) ?? "Former administrator",
      revisions: note.revisions.map((revision) => ({ id: revision.id, title: revision.title, body: revision.body, kind: revision.kind, noteDate: revision.noteDate.toISOString().slice(0, 10), createdAt: revision.createdAt.toISOString(), actorName: names.get(revision.actorId) ?? "Former administrator", reason: revision.reason })),
    })) });
  } catch (error) { return failFromUnknown(error); }
}

const createSchema = employeeNoteFields.extend({ employeeId: z.string().min(1) });
export async function createEmployeeNote(input: z.input<typeof createSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdmin();
  try {
    const data = createSchema.parse(input);
    const noteId = randomUUID();
    const revisionId = randomUUID();
    const content = { title: data.title, body: data.body, reason: null };
    const [sealedNote, sealedRevision] = await Promise.all([
      encryptEmployeeNoteContent(content, noteId),
      encryptEmployeeNoteContent({ ...content, reason: "Created" }, revisionId, true),
    ]);
    const note = await db.$transaction(async (tx) => {
      if (!await tx.employee.findUnique({ where: { id: data.employeeId }, select: { id: true } })) throw new Error("That employee no longer exists.");
      const snapshot = { kind: data.kind, noteDate: parseDateOnly(data.noteDate)! };
      const record = await tx.employeeNote.create({ data: { id: noteId, ...snapshot, ...sealedNote, employeeId: data.employeeId, createdById: actor.id } });
      const revision = await tx.employeeNoteRevision.create({ data: { id: revisionId, ...snapshot, ...sealedRevision, noteId: record.id, actorId: actor.id } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email, action: "employee.note.create", resource: `EmployeeNote:${record.id}`, diff: { employeeId: data.employeeId, revisionId: revision.id, kind: data.kind, noteDate: data.noteDate } } });
      return record;
    });
    revalidatePath(`/admin/employees/${data.employeeId}`);
    return ok({ id: note.id });
  } catch (error) { return failFromUnknown(error); }
}

const updateSchema = employeeNoteFields.extend({ id: z.string().min(1), expectedUpdatedAt: z.string().datetime(), reason: z.string().trim().min(3, "Enter a reason for this change.").max(500) });
export async function updateEmployeeNote(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const actor = await requireAdmin();
  try {
    const data = updateSchema.parse(input);
    const revisionId = randomUUID();
    const content = { title: data.title, body: data.body, reason: data.reason };
    const [sealedNote, sealedRevision] = await Promise.all([
      encryptEmployeeNoteContent(content, data.id),
      encryptEmployeeNoteContent(content, revisionId, true),
    ]);
    const employeeId = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-note:${data.id}`}))`;
      const note = await tx.employeeNote.findUnique({ where: { id: data.id } });
      if (!note) throw new Error("That note no longer exists.");
      assertNoteRevision(note, data.expectedUpdatedAt);
      const snapshot = { kind: data.kind, noteDate: parseDateOnly(data.noteDate)! };
      await tx.employeeNote.update({ where: { id: note.id }, data: { ...snapshot, ...sealedNote } });
      const revision = await tx.employeeNoteRevision.create({ data: { id: revisionId, ...snapshot, ...sealedRevision, noteId: note.id, actorId: actor.id } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email, action: "employee.note.update", resource: `EmployeeNote:${note.id}`, diff: { employeeId: note.employeeId, revisionId: revision.id, kind: data.kind, noteDate: data.noteDate } } });
      return note.employeeId;
    });
    revalidatePath(`/admin/employees/${employeeId}`); return ok();
  } catch (error) { return failFromUnknown(error); }
}

const archiveSchema = z.object({ id: z.string().min(1), expectedUpdatedAt: z.string().datetime(), reason: z.string().trim().min(3, "Enter a reason for archiving.").max(500) });
export async function archiveEmployeeNote(input: z.input<typeof archiveSchema>): Promise<ActionResult> {
  const actor = await requireAdmin();
  try {
    const data = archiveSchema.parse(input);
    const existing = await db.employeeNote.findUnique({ where: { id: data.id } });
    if (!existing) throw new Error("That note no longer exists.");
    assertNoteRevision(existing, data.expectedUpdatedAt);
    const readable = await decryptEmployeeNoteContent(existing);
    const revisionId = randomUUID();
    const content = { title: readable.title, body: readable.body, reason: `Archived: ${data.reason}` };
    const [sealedNote, sealedRevision] = await Promise.all([
      encryptEmployeeNoteContent(content, data.id),
      encryptEmployeeNoteContent(content, revisionId, true),
    ]);
    const employeeId = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-note:${data.id}`}))`;
      const note = await tx.employeeNote.findUnique({ where: { id: data.id } });
      if (!note) throw new Error("That note no longer exists.");
      assertNoteRevision(note, data.expectedUpdatedAt);
      await tx.employeeNote.update({ where: { id: note.id }, data: { isArchived: true, ...sealedNote } });
      const revision = await tx.employeeNoteRevision.create({ data: { id: revisionId, ...sealedRevision, kind: note.kind, noteDate: note.noteDate, noteId: note.id, actorId: actor.id } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email, action: "employee.note.archive", resource: `EmployeeNote:${note.id}`, diff: { employeeId: note.employeeId, revisionId: revision.id } } });
      return note.employeeId;
    });
    revalidatePath(`/admin/employees/${employeeId}`); return ok();
  } catch (error) { return failFromUnknown(error); }
}
