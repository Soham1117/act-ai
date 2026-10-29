import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertNoteRevision, employeeNoteFields } from "@/lib/employee-notes";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), transaction: vi.fn(), employeeFind: vi.fn(), noteFind: vi.fn(), noteCreate: vi.fn(),
  noteUpdate: vi.fn(), revisionCreate: vi.fn(), audit: vi.fn(), lock: vi.fn(), noteList: vi.fn(), userList: vi.fn(), refresh: vi.fn(),
  encrypt: vi.fn(), decrypt: vi.fn(), sealed: new Map<string, string>(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/sensitive-data", () => ({
  encryptSensitiveText: mocks.encrypt, decryptSensitiveText: mocks.decrypt,
  isEncryptedSensitiveText: (value: string) => value.startsWith("act-kms-text:"),
  SensitiveDataError: class extends Error {},
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction, employeeNote: { findUnique: mocks.noteFind, findMany: mocks.noteList }, user: { findMany: mocks.userList } } }));
import { archiveEmployeeNote, createEmployeeNote, getEmployeeNotes, updateEmployeeNote } from "./actions/employee-notes";

const actor = { id: "00000000-0000-0000-0000-000000000001", email: "admin@example.test" };
const now = new Date("2026-10-28T12:00:00Z");
const note = { id: "note-a", employeeId: "employee-a", title: "Personnel discussion", body: "Private example information", kind: "GENERAL", noteDate: new Date("2026-10-27"), createdById: actor.id, createdAt: now, updatedAt: now, isArchived: false };
const input = { title: note.title, body: note.body, kind: "GENERAL" as const, noteDate: "2026-10-27" };
const tx = { $executeRaw: mocks.lock, employee: { findUnique: mocks.employeeFind }, employeeNote: { findUnique: mocks.noteFind, create: mocks.noteCreate, update: mocks.noteUpdate }, employeeNoteRevision: { create: mocks.revisionCreate }, auditLog: { create: mocks.audit } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sealed.clear();
  mocks.encrypt.mockImplementation(async (text: string, context: { recordId: string }) => {
    const sealed = `act-kms-text:${context.recordId}`;
    mocks.sealed.set(sealed, text);
    return sealed;
  });
  mocks.decrypt.mockImplementation(async (value: string) => mocks.sealed.get(value) ?? value);
  mocks.admin.mockResolvedValue(actor);
  mocks.transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  mocks.employeeFind.mockResolvedValue({ id: "employee-a" }); mocks.noteFind.mockResolvedValue(note);
  mocks.noteCreate.mockResolvedValue(note); mocks.revisionCreate.mockResolvedValue({ id: "revision-a" });
  mocks.noteList.mockResolvedValue([{ ...note, revisions: [{ id: "revision-a", ...input, noteDate: note.noteDate, createdAt: now, actorId: actor.id, reason: "Created" }] }]);
  mocks.userList.mockResolvedValue([{ id: actor.id, name: "Test administrator" }]);
});

describe("private employee notes", () => {
  it("requires a writable admin even for reading, before any database access", async () => {
    mocks.admin.mockRejectedValue(new Error("Not authorized"));
    await expect(getEmployeeNotes("employee-a")).rejects.toThrow("Not authorized");
    await expect(createEmployeeNote({ ...input, employeeId: "employee-a" })).rejects.toThrow("Not authorized");
    await expect(updateEmployeeNote({ ...input, id: note.id, expectedUpdatedAt: now.toISOString(), reason: "Correct spelling" })).rejects.toThrow("Not authorized");
    await expect(archiveEmployeeNote({ id: note.id, expectedUpdatedAt: now.toISOString(), reason: "Archive record" })).rejects.toThrow("Not authorized");
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.noteList).not.toHaveBeenCalled(); expect(mocks.userList).not.toHaveBeenCalled();
  });
  it("rejects invalid dates, blank bodies, and unrecognized kinds", () => {
    expect(employeeNoteFields.safeParse({ ...input, noteDate: "2026-02-30" }).success).toBe(false);
    expect(employeeNoteFields.safeParse({ ...input, body: "  " }).success).toBe(false);
    expect(employeeNoteFields.safeParse({ ...input, kind: "ACTIVE" }).success).toBe(false);
  });
  it("creates an immutable snapshot and audit metadata without private body text", async () => {
    const result = await createEmployeeNote({ ...input, employeeId: note.employeeId });
    expect(result).toMatchObject({ ok: true, id: note.id });
    expect(mocks.revisionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ body: expect.stringMatching(/^act-kms-text:/), title: "Private employee note", reason: "Private revision", noteId: note.id, actorId: actor.id }) });
    expect(JSON.stringify(mocks.revisionCreate.mock.calls)).not.toContain(note.body);
    expect(JSON.stringify(mocks.noteCreate.mock.calls)).not.toContain(note.body);
    expect(JSON.stringify(mocks.noteCreate.mock.calls)).not.toContain(note.title);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(note.body);
    expect(mocks.noteCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ createdById: actor.id, employeeId: note.employeeId }) });
  });
  it("refuses a second stale editor after the first writer's timestamp changes", async () => {
    const edit = { ...input, id: note.id, expectedUpdatedAt: now.toISOString(), reason: "Correct spelling" };
    expect((await updateEmployeeNote(edit)).ok).toBe(true);
    mocks.noteFind.mockResolvedValue({ ...note, updatedAt: new Date(now.getTime() + 1) });
    expect((await updateEmployeeNote(edit)).ok).toBe(false);
    expect(mocks.lock).toHaveBeenCalledTimes(2);
    expect(mocks.noteUpdate).toHaveBeenCalledTimes(1); expect(mocks.revisionCreate).toHaveBeenCalledTimes(1);
  });
  it("archives with retained history and rejects further mutation", async () => {
    expect((await archiveEmployeeNote({ id: note.id, expectedUpdatedAt: now.toISOString(), reason: "No longer current" })).ok).toBe(true);
    expect(mocks.noteUpdate).toHaveBeenCalledWith({ where: { id: note.id }, data: expect.objectContaining({ isArchived: true, title: "Private employee note", body: expect.stringMatching(/^act-kms-text:/) }) });
    expect(mocks.revisionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ body: expect.stringMatching(/^act-kms-text:/), reason: "Private revision" }) });
    expect([...mocks.sealed.values()].some(value => value.includes("Archived: No longer current"))).toBe(true);
    expect(() => assertNoteRevision({ ...note, isArchived: true }, now.toISOString())).toThrow("archived");
  });
  it("uses the actual author records when reading notes and revision history", async () => {
    const result = await getEmployeeNotes(note.employeeId);
    expect(result).toMatchObject({ ok: true, notes: [{ createdByName: "Test administrator", revisions: [{ actorName: "Test administrator" }] }] });
    expect(mocks.userList).toHaveBeenCalledWith({ where: { id: { in: [actor.id] } }, select: { id: true, name: true } });
  });

  it("writes neither a note nor revision if KMS encryption fails", async () => {
    mocks.encrypt.mockRejectedValue(new Error("Secure data storage is unavailable"));
    expect((await createEmployeeNote({ ...input, employeeId: note.employeeId })).ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.noteCreate).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });
});
