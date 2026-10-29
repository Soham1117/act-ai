import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), employee: vi.fn(), roster: vi.fn(), find: vi.fn(), list: vi.fn(), create: vi.fn(), remove: vi.fn(), audit: vi.fn(), notify: vi.fn(), upload: vi.fn(), cleanup: vi.fn(), broadDelete: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/storage", () => ({ uploadFile: mocks.upload, deleteFile: mocks.cleanup }));
import { payrollVersion, persistPayrollDocument } from "./paystub-persistence";

const bytes = Uint8Array.from([37, 80, 68, 70, 45, 84, 69, 83, 84]).buffer;
const hash = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
const old = { id: "old-stub", employeeId: "employee-a", category: "Pay Stub", fileName: "employee-a/old.pdf", fileSha256: "old-hash", semanticHash: null, payPeriodStart: new Date("2026-10-01"), payPeriodEnd: new Date("2026-10-14"), uploadedAt: new Date("2026-10-16T12:00:00Z") };
const input = () => ({ actor: { id: "admin-test", email: "admin@example.test" }, employeeId: "employee-a", title: "Synthetic pay document", category: "Pay Stub", payPeriodStart: "2026-10-01", payPeriodEnd: "2026-10-14", bytes, fileType: "application/pdf", safeName: "synthetic.pdf", provenance: { sourceSha256: "a".repeat(64), sourceFileName: "synthetic-combined.pdf", sourcePage: 2, importKey: "synthetic-source-page-key", semanticHash: "synthetic-check-hash", payDate: "2026-10-16", checkReference: "TEST-1" } });
const replacement = () => ({ ...input(), replaceId: old.id, replaceVersion: payrollVersion(old) });
const tx = { $executeRaw: mocks.lock, employee: { findUnique: mocks.employee, findMany: mocks.roster }, payroll: { findUnique: mocks.find, findMany: mocks.list, create: mocks.create, delete: mocks.remove, deleteMany: mocks.broadDelete }, auditLog: { create: mocks.audit }, notification: { create: mocks.notify } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  mocks.employee.mockResolvedValue({ id: "employee-a", employmentStatus: "ACTIVE", w2ConsentAt: null });
  mocks.find.mockImplementation(async ({ where }) => where.id === old.id ? old : null);
  mocks.list.mockResolvedValue([]); mocks.create.mockResolvedValue({ id: "saved-stub" });
  mocks.upload.mockResolvedValue(undefined); mocks.cleanup.mockResolvedValue(undefined);
});

describe("shared payroll persistence", () => {
  it("stages privately before a locked transaction that owns document, audit, and notification", async () => {
    expect(await persistPayrollDocument(input())).toMatchObject({ pageNumber: 2, status: "SAVED", id: "saved-stub" });
    expect(mocks.upload).toHaveBeenCalledWith("payroll", expect.stringMatching(/^employee-a\/2026-10-14-.+-synthetic\.pdf$/), bytes, { contentType: "application/pdf" });
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(mocks.transaction.mock.invocationCallOrder[0]);
    expect(mocks.lock.mock.calls[0][0].join("")).toMatch(/pg_advisory_xact_lock/);
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.employee.mock.invocationCallOrder[0]);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ employeeId: "employee-a", fileSha256: hash, importKey: "synthetic-source-page-key", sourcePage: 2, payDate: new Date("2026-10-16") }) });
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ resource: "Payroll:saved-stub", diff: expect.objectContaining({ sourcePage: 2, reviewed: true }) }) });
    expect(mocks.notify).toHaveBeenCalledWith({ data: expect.objectContaining({ recipients: { create: { employeeId: "employee-a" } } }) });
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it.each(["PENDING_REVIEW", "MISSING"])("rechecks employee eligibility (%s) inside the transaction", async (status) => {
    mocks.employee.mockResolvedValue(status === "MISSING" ? null : { id: "employee-a", employmentStatus: status });
    await expect(persistPayrollDocument(input())).rejects.toThrow(/onboarding is not approved/i);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });
  it("preserves electronic W-2 consent rules for shared legacy writes", async () => {
    await expect(persistPayrollDocument({ ...input(), category: "W-2", provenance: undefined })).rejects.toThrow(/consent is required/i);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rechecks reviewed roster evidence after acquiring the write lock", async () => {
    const roster = [{ id: "employee-a", name: "Synthetic Person", ssnLast4: "0000", employmentStatus: "ACTIVE" }];
    mocks.roster.mockResolvedValue(roster);
    const reviewedHash = createHash("sha256").update(JSON.stringify(roster)).digest("hex");
    expect(await persistPayrollDocument({ ...input(), expectedRosterHash: reviewedHash })).toMatchObject({ status: "SAVED" });
    mocks.roster.mockResolvedValue([{ ...roster[0], name: "Corrected Synthetic Name" }]);
    mocks.create.mockClear();
    await expect(persistPayrollDocument({ ...input(), expectedRosterHash: reviewedHash })).rejects.toThrow(/roster changed during review/i);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.roster.mock.invocationCallOrder[0]);
  });
  it("returns an identical source/page retry without another audit or notification", async () => {
    mocks.find.mockResolvedValue({ ...old, id: "existing-stub" });
    expect(await persistPayrollDocument(input())).toMatchObject({ status: "EXISTING", id: "existing-stub" });
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledWith("payroll", mocks.upload.mock.calls[0][1]);
  });
  it.each([{ employeeId: "employee-b" }, { payPeriodEnd: new Date("2026-10-15") }])("rejects an import-key retry with a conflicting decision: %j", async (changes) => {
    mocks.find.mockResolvedValue({ ...old, ...changes });
    await expect(persistPayrollDocument(input())).rejects.toThrow(/different employee or period/i);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });
  it("blocks identical generated content or semantic checks belonging to another employee", async () => {
    for (const same of [{ fileSha256: hash }, { semanticHash: "synthetic-check-hash" }]) {
      mocks.list.mockResolvedValue([{ ...old, employeeId: "employee-b", ...same }]);
      await expect(persistPayrollDocument(input())).rejects.toThrow(/another employee/i);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["employee-a", "employee-b"])("rejects an additional check whose original single-page PDF already belongs to %s", async (employeeId) => {
    const request = { ...input(), sourcePageCount: 1, provenance: { ...input().provenance, sourcePage: 1 } };
    const legacy = { ...old, employeeId, fileSha256: request.provenance.sourceSha256, semanticHash: null };
    mocks.list.mockImplementation(async ({ where }) => where.OR.some((clause: { fileSha256?: string }) => clause.fileSha256 === legacy.fileSha256) ? [legacy] : []);
    const decision = { pageNumber: 1, employeeId: "employee-a", payPeriodStart: "2026-10-01", payPeriodEnd: "2026-10-14", reviewToken: "b".repeat(64), confirmed: true as const, duplicateMode: "ADDITIONAL" as const };
    await expect(persistPayrollDocument({ ...request, decision })).rejects.toThrow(employeeId === "employee-a" ? /identical contents or check reference/i : /another employee/i);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith("payroll", mocks.upload.mock.calls[0][1]);
  });
  it("allows the same generic letter bytes to be delivered to another employee", async () => {
    const otherEmployeeLetter = { ...old, employeeId: "employee-b", category: "Bonus letter", fileSha256: hash };
    mocks.list.mockImplementation(async ({ where }) => where.OR.some((clause: { employeeId?: string; fileSha256?: string }) => clause.fileSha256 === hash && (!clause.employeeId || clause.employeeId === otherEmployeeLetter.employeeId)) ? [otherEmployeeLetter] : []);
    expect(await persistPayrollDocument({ ...input(), category: "Bonus letter", provenance: undefined })).toMatchObject({ status: "SAVED", id: "saved-stub" });
    expect(mocks.notify).toHaveBeenCalledWith({ data: expect.objectContaining({ recipients: { create: { employeeId: "employee-a" } } }) });
  });
  it("requires duplicate review and only permits an additional distinct check", async () => {
    mocks.list.mockResolvedValue([old]);
    await expect(persistPayrollDocument(input())).rejects.toThrow(/already exists for this employee and period/i);
    const decision = { pageNumber: 2, employeeId: "employee-a", payPeriodStart: "2026-10-01", payPeriodEnd: "2026-10-14", reviewToken: "b".repeat(64), confirmed: true as const, duplicateMode: "ADDITIONAL" as const };
    expect(await persistPayrollDocument({ ...input(), decision })).toMatchObject({ status: "SAVED" });
    mocks.list.mockResolvedValue([{ ...old, semanticHash: "synthetic-check-hash" }]);
    await expect(persistPayrollDocument({ ...input(), decision })).rejects.toThrow(/identical contents or check reference/i);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("replaces exactly the selected document while retaining other checks for the period", async () => {
    mocks.list.mockResolvedValue([old, { ...old, id: "supplemental-check", fileSha256: "another-hash" }]);
    expect(await persistPayrollDocument(replacement())).toMatchObject({ status: "SAVED", replaced: 1 });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ where: { id: old.id } });
    expect(mocks.broadDelete).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith("payroll", old.fileName);
    expect(mocks.cleanup.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.notify.mock.invocationCallOrder[0]);
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ diff: expect.objectContaining({ replacedIds: [old.id] }) }) });
  });
  it.each([{ uploadedAt: new Date("2026-10-17") }, { employeeId: "employee-b" }, { category: "W-2" }, { payPeriodEnd: new Date("2026-10-15") }])("rejects stale or out-of-scope replacements: %j", async (changes) => {
    mocks.find.mockImplementation(async ({ where }) => where.id === old.id ? { ...old, ...changes } : null);
    await expect(persistPayrollDocument(replacement())).rejects.toThrow(/changed|another employee, category, or period/i);
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not start a database transaction when private storage staging fails", async () => {
    mocks.upload.mockRejectedValue(new Error("Storage unavailable"));
    await expect(persistPayrollDocument(input())).rejects.toThrow("Storage unavailable");
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
  });
  it.each(["create", "audit", "notify"] as const)("rolls back replacement and cleans its staged object when %s fails", async (operation) => {
    const records = new Set([old.id]);
    mocks.create.mockImplementation(async () => { records.add("saved-stub"); return { id: "saved-stub" }; });
    mocks.remove.mockImplementation(async () => { records.delete(old.id); });
    mocks[operation].mockRejectedValue(new Error(`${operation} unavailable`));
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const before = new Set(records);
      try { return await callback(tx); }
      catch (error) { records.clear(); for (const record of before) records.add(record); throw error; }
    });
    await expect(persistPayrollDocument(replacement())).rejects.toThrow(`${operation} unavailable`);
    expect([...records]).toEqual([old.id]);
    expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith("payroll", mocks.upload.mock.calls[0][1]);
    expect(mocks.cleanup).not.toHaveBeenCalledWith("payroll", old.fileName);
  });
  it("reports a saved receipt with a warning when old-object cleanup fails after commit", async () => {
    mocks.cleanup.mockRejectedValue(new Error("Object store unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await persistPayrollDocument(replacement())).toMatchObject({ status: "SAVED", id: "saved-stub", warning: expect.stringMatching(/saved successfully/i) });
      expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith("payroll", old.fileName);
    } finally { log.mockRestore(); }
  });
  it("preserves an existing receipt when its redundant staged-object cleanup fails", async () => {
    mocks.find.mockResolvedValue(old);
    mocks.cleanup.mockRejectedValue(new Error("Object store unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await persistPayrollDocument(input())).toMatchObject({ status: "EXISTING", id: old.id, warning: expect.any(String) });
      expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it("serializes simultaneous source-page confirms and returns one saved and one existing receipt", async () => {
    let saved: typeof old | null = null;
    let queue: Promise<void> = Promise.resolve();
    mocks.find.mockImplementation(async () => saved);
    mocks.create.mockImplementation(async () => { saved = { ...old, id: "saved-stub" }; return saved; });
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => { release = resolve; });
      const lockedTx = { ...tx, $executeRaw: vi.fn(async (...args: unknown[]) => { mocks.lock(...args); await previous; return 1; }) };
      try { return await callback(lockedTx); } finally { release(); }
    });
    const receipts = await Promise.all([persistPayrollDocument(input()), persistPayrollDocument(input())]);
    expect(receipts.map((receipt) => receipt.status).sort()).toEqual(["EXISTING", "SAVED"]);
    expect(mocks.lock).toHaveBeenCalledTimes(2); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.notify).toHaveBeenCalledTimes(1); expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});
