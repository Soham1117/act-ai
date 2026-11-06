import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FindingDraft } from "@/lib/watch/types";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), lock: vi.fn(), running: vi.fn(), createRun: vi.fn(), finishRun: vi.fn(),
  config: vi.fn(), findFinding: vi.fn(), createFinding: vi.fn(), updateFinding: vi.fn(), resolveFindings: vi.fn(),
  firstRule: vi.fn(), secondRule: vi.fn(), digest: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {
  $transaction: mocks.transaction,
  watchRun: { update: mocks.finishRun },
  watchRuleConfig: { findUnique: mocks.config },
  watchFinding: { findUnique: mocks.findFinding, create: mocks.createFinding, update: mocks.updateFinding, updateMany: mocks.resolveFindings },
} }));
vi.mock("./jobs", () => ({ ALL_JOBS: [
  { id: "time.impossible-shift", run: mocks.firstRule },
  { id: "other.rule", run: mocks.secondRule },
] }));
vi.mock("./digest", () => ({ sendDailyDigestIfDue: mocks.digest }));

import { runWatch } from "./runner";

const draft: FindingDraft = {
  fingerprint: "time.impossible-shift:entry", severity: "CRITICAL",
  subjectType: "TimeEntry", subjectId: "entry", title: "Long shift", detail: "17 hours", evidence: {},
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (callback) => callback({
    $executeRaw: mocks.lock,
    watchRun: { findFirst: mocks.running, create: mocks.createRun },
  }));
  mocks.running.mockResolvedValue(null);
  mocks.createRun.mockImplementation(async ({ data }) => ({ id: "run", ...data }));
  mocks.config.mockResolvedValue(null);
  mocks.firstRule.mockResolvedValue([]);
  mocks.secondRule.mockResolvedValue([]);
  mocks.resolveFindings.mockResolvedValue({ count: 0 });
  mocks.digest.mockResolvedValue({ errors: [] });
});

describe("Watch runner", () => {
  it("claims the run under a database lock and skips an active run", async () => {
    mocks.running.mockResolvedValue({ id: "existing" });
    expect(await runWatch({ trigger: "MANUAL" })).toMatchObject({ skipped: "already-running", runId: "existing" });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.running.mock.invocationCallOrder[0]!);
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.firstRule).not.toHaveBeenCalled();
  });

  it("clears a corrected acknowledged finding when its fingerprint is gone", async () => {
    mocks.resolveFindings.mockResolvedValueOnce({ count: 1 });
    const result = await runWatch({ trigger: "MANUAL", ruleIds: ["time.impossible-shift"] });
    expect(result.autoResolved).toBe(1);
    expect(mocks.resolveFindings).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ruleId: "time.impossible-shift", status: { in: ["OPEN", "ACKNOWLEDGED", "SNOOZED"] }, fingerprint: { notIn: [] } }),
      data: expect.objectContaining({ status: "RESOLVED" }),
    }));
    expect(mocks.secondRule).not.toHaveBeenCalled();
    expect(mocks.digest).not.toHaveBeenCalled();
  });

  it("keeps a genuine issue acknowledged, dismissed issues dismissed, and reopens recurrences", async () => {
    mocks.firstRule.mockResolvedValue([draft]);
    for (const [status, expected] of [["ACKNOWLEDGED", "ACKNOWLEDGED"], ["DISMISSED", "DISMISSED"], ["RESOLVED", "OPEN"]]) {
      mocks.findFinding.mockResolvedValue({ id: "finding", status, snoozeUntil: null, resolvedAt: null });
      await runWatch({ trigger: "MANUAL", ruleIds: ["time.impossible-shift"] });
      expect(mocks.updateFinding).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: expected }) }));
      expect(mocks.resolveFindings).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ fingerprint: { notIn: [draft.fingerprint] } }) }));
    }
  });

  it("sends nothing in shadow mode but preserves scheduled delivery in live mode", async () => {
    await runWatch({ trigger: "SCHEDULE", shadow: true });
    expect(mocks.digest).not.toHaveBeenCalled();
    await runWatch({ trigger: "SCHEDULE", shadow: false });
    expect(mocks.digest).toHaveBeenCalledOnce();
  });

  it("does not clear findings for a failed rule and still runs the next rule", async () => {
    mocks.firstRule.mockRejectedValue(new Error("query failed"));
    const result = await runWatch({ trigger: "MANUAL" });
    expect(result.errors).toEqual([{ ruleId: "time.impossible-shift", message: "query failed" }]);
    expect(mocks.secondRule).toHaveBeenCalledOnce();
    expect(mocks.resolveFindings).toHaveBeenCalledOnce();
    expect(mocks.resolveFindings).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ruleId: "other.rule" }) }));
    expect(mocks.finishRun).toHaveBeenCalledOnce();
  });

  it("releases a run and records a fatal setup failure", async () => {
    mocks.config.mockRejectedValue(new Error("policy unavailable"));
    await expect(runWatch({ trigger: "MANUAL" })).rejects.toThrow("policy unavailable");
    expect(mocks.finishRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ finishedAt: expect.any(Date), errors: [{ ruleId: "runner", message: "policy unavailable" }] }) }));
  });
});
