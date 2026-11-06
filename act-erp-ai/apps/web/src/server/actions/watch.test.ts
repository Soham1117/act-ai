import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), find: vi.fn(), transaction: vi.fn(), update: vi.fn(), updateMany: vi.fn(), audit: vi.fn(), run: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/db", () => ({ db: {
  watchFinding: { findUnique: mocks.find }, $transaction: mocks.transaction,
} }));
vi.mock("@/server/watch/jobs", () => ({ ALL_JOBS: [{ id: "time.impossible-shift" }] }));
vi.mock("@/server/watch/runner", () => ({ runWatch: mocks.run, loadPolicy: vi.fn() }));
vi.mock("@/server/watch/digest", () => ({ composeDigest: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendPlainEmail: vi.fn() }));

import { actOnFinding } from "./watch";

const finding = { id: "flag", ruleId: "time.impossible-shift", status: "ACKNOWLEDGED", detail: "17 hours" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ id: "admin", email: "admin@example.test" });
  mocks.find.mockResolvedValueOnce(finding).mockResolvedValue({ ...finding, status: "RESOLVED" });
  mocks.run.mockResolvedValue({ errors: [], autoResolved: 1 });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (callback) => callback({
    watchFinding: { update: mocks.update, updateMany: mocks.updateMany }, auditLog: { create: mocks.audit },
  }));
});

describe("Watch recheck and resolve", () => {
  it("reruns just the relevant check and audits a confirmed resolution", async () => {
    expect(await actOnFinding({ id: "flag", action: "RESOLVE", note: "Checked" })).toMatchObject({ ok: true });
    expect(mocks.run).toHaveBeenCalledWith({ trigger: "MANUAL", shadow: true, ruleIds: [finding.ruleId] });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "flag", status: "RESOLVED" }, data: { handledById: "admin", handledNote: "Checked" } });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "watch.finding.resolve" }) }));
  });
  it("refuses to clear a condition that is still detected", async () => {
    mocks.find.mockReset().mockResolvedValue(finding);
    expect(await actOnFinding({ id: "flag", action: "RESOLVE" })).toMatchObject({ ok: false, error: expect.stringContaining("Still flagged") });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("does not overwrite a recurrence reopened during the recheck", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect(await actOnFinding({ id: "flag", action: "RESOLVE" })).toMatchObject({ ok: false, error: expect.stringContaining("changed during") });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("leaves the finding intact when its check failed", async () => {
    mocks.run.mockResolvedValueOnce({ errors: [{ ruleId: finding.ruleId, message: "failed" }] });
    expect(await actOnFinding({ id: "flag", action: "RESOLVE" })).toMatchObject({ ok: false, error: expect.stringContaining("recheck failed") });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("keeps the finding when another run owns the lock", async () => {
    mocks.run.mockResolvedValue({ skipped: "already-running", errors: [] });
    expect(await actOnFinding({ id: "flag", action: "RESOLVE" })).toMatchObject({ ok: false, error: expect.stringContaining("already running") });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("requires an admin before running a check", async () => {
    mocks.admin.mockRejectedValue(new Error("Forbidden"));
    await expect(actOnFinding({ id: "flag", action: "RESOLVE" })).rejects.toThrow("Forbidden");
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
