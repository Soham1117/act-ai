import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  finding: vi.fn(), findings: vi.fn(), entry: vi.fn(), entryOrThrow: vi.fn(), entryOther: vi.fn(), entryUpdate: vi.fn(),
  proposal: vi.fn(), proposalCreate: vi.fn(), proposalUpdate: vi.fn(), schedules: vi.fn(),
  user: vi.fn(), period: vi.fn(), query: vi.fn(), audit: vi.fn(), close: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  watchFinding: { findUnique: mocks.finding, findMany: mocks.findings }, timeEntry: { findUnique: mocks.entry }, watchProposal: { findUnique: mocks.proposal },
} }));
vi.mock("@/server/time-core", () => ({ withEmployeeLock: mocks.lock, closeOpenEntry: mocks.close }));

import { createProposal, decideProposal, queueAutomaticClockOutProposals } from "./proposals";
import { proposalEntrySnapshot } from "@/lib/watch/proposals";

const actor = { id: "admin", email: "admin@example.test" };
const start = new Date("2026-10-01T13:00:00Z");
const end = new Date("2026-10-01T21:00:00Z");
let entry: Record<string, unknown>;
let proposal: Record<string, unknown>;
const tx = {
  user: { findUnique: mocks.user }, watchFinding: { findUnique: mocks.finding },
  timeEntry: { findUnique: mocks.entry, findUniqueOrThrow: mocks.entryOrThrow, findFirst: mocks.entryOther, update: mocks.entryUpdate },
  watchProposal: { findFirst: mocks.proposal, findUnique: mocks.proposal, findUniqueOrThrow: mocks.proposal, create: mocks.proposalCreate, update: mocks.proposalUpdate },
  schedule: { findMany: mocks.schedules }, payrollCalendar: { findFirst: mocks.period },
  auditLog: { create: mocks.audit }, $queryRaw: mocks.query,
};

beforeEach(() => {
  vi.resetAllMocks();
  entry = { id: "entry", employeeId: "employee", date: new Date("2026-10-01"), clockIn: start, clockOut: null, status: "ACTIVE", approvalStatus: "PENDING", totalWorkMin: 0, totalBreakMin: 0, updatedAt: start, jobCode: "SHOP", autoClosed: false, lastEditedById: null, editReason: null, approvedById: null, approvalDate: null, approvalNotes: null, breaks: [] };
  proposal = { id: "proposal", findingId: "finding", entryId: "entry", employeeId: "employee", status: "PENDING", before: proposalEntrySnapshot(entry as never), proposedClockOut: end, reason: "Confirmed missed punch", evidence: { scheduleId: "schedule", scheduleUpdatedAt: start.toISOString() } };
  mocks.findings.mockResolvedValue([{ id: "finding" }]);
  mocks.user.mockResolvedValue({ role: "ADMIN", employee: null });
  mocks.lock.mockImplementation(async (_id, callback) => callback(tx));
  mocks.finding.mockResolvedValue({ id: "finding", ruleId: "time.missing-clock-out", subjectType: "TimeEntry", subjectId: "entry", status: "OPEN" });
  mocks.entry.mockImplementation(async () => entry);
  mocks.entryOrThrow.mockImplementation(async () => entry);
  mocks.proposal.mockImplementation(async () => proposal);
  mocks.schedules.mockResolvedValue([{ id: "schedule", date: new Date("2026-10-01"), startTime: "08:00", endTime: "16:00", updatedAt: start }]);
  mocks.proposalCreate.mockImplementation(async ({ data }) => ({ id: "proposal", ...data }));
  mocks.proposalUpdate.mockImplementation(async ({ data }) => { Object.assign(proposal, data); return proposal; });
  mocks.entryUpdate.mockImplementation(async ({ data }) => { Object.assign(entry, data, { updatedAt: end }); return entry; });
  mocks.close.mockImplementation(async (_tx, _entry, out, extra) => { Object.assign(entry, { clockOut: out, status: "COMPLETED", approvalStatus: "PENDING", totalWorkMin: 480, updatedAt: end }, extra); return { entry, capped: false }; });
});

describe("L3 missing-clock-out lifecycle", () => {
  it("creates a schedule-evidenced draft without changing a punch", async () => {
    mocks.proposal.mockResolvedValue(null);
    expect(await createProposal(actor, { findingId: "finding", reason: "Review missed punch" })).toEqual({ ok: true, id: "proposal" });
    expect(mocks.proposalCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ before: expect.objectContaining({ clockOut: null }), proposedClockOut: end, evidence: expect.objectContaining({ scheduleId: "schedule" }) }) });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.entryUpdate).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "watch.proposal.create" }) }));
  });
  it("returns the existing pending draft instead of duplicating it", async () => {
    expect(await createProposal(actor, { findingId: "finding", reason: "Review missed punch" })).toEqual({ ok: true, id: "proposal" });
    expect(mocks.proposalCreate).not.toHaveBeenCalled();
  });
  it("declines to infer an open break end", async () => {
    entry.breaks = [{ id: "break", startTime: start, endTime: null }];
    expect(await createProposal(actor, { findingId: "finding", reason: "Review missed punch" })).toMatchObject({ ok: false, error: expect.stringContaining("open break") });
    expect(mocks.proposalCreate).not.toHaveBeenCalled();
  });
  it("requires confirmation of the actual end before applying", async () => {
    expect(await decideProposal(actor, { id: "proposal", action: "APPROVE" })).toMatchObject({ ok: false });
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it("applies exactly once, keeps payroll approval pending and audits before/after", async () => {
    const input = { id: "proposal", action: "APPROVE" as const, confirmedActualEnd: true };
    expect(await decideProposal(actor, input)).toEqual({ ok: true, id: "proposal", status: "APPLIED" });
    expect(mocks.close).toHaveBeenCalledWith(tx, entry, end, expect.objectContaining({ autoClosed: false, lastEditedById: actor.id }), expect.any(Number));
    expect(entry.approvalStatus).toBe("PENDING");
    expect(proposal.after).toEqual(proposalEntrySnapshot(entry as never));
    expect(mocks.query).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "watch.proposal.apply", diff: expect.objectContaining({ before: expect.objectContaining({ clockOut: null }), after: expect.objectContaining({ clockOut: end.toISOString() }) }) }) }));
    await decideProposal(actor, input);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it.each(["entry", "break"])("refuses changed %s data and records an actionable failure", async (kind) => {
    if (kind === "entry") entry.updatedAt = end;
    else entry.breaks = [{ id: "new-break", startTime: start, endTime: end, durationMin: 480 }];
    expect(await decideProposal(actor, { id: "proposal", action: "APPROVE", confirmedActualEnd: true })).toMatchObject({ ok: false, error: expect.stringContaining("changed") });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(proposal.status).toBe("PENDING");
    expect(proposal.lastError).toEqual(expect.stringContaining("changed"));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "watch.proposal.failed" }) }));
  });
  it("accepts PostgreSQL JSONB object key reordering", async () => {
    proposal.before = Object.fromEntries(Object.entries(proposal.before as object).reverse());
    expect(await decideProposal(actor, { id: "proposal", action: "APPROVE", confirmedActualEnd: true })).toMatchObject({ ok: true, status: "APPLIED" });
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it("rejects without changing a punch", async () => {
    expect(await decideProposal(actor, { id: "proposal", action: "REJECT" })).toMatchObject({ ok: true, status: "REJECTED" });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.entryUpdate).not.toHaveBeenCalled();
  });
  it.each(["closed period", "overlap", "changed schedule"])("refuses approval with %s", async (kind) => {
    if (kind === "closed period") mocks.period.mockResolvedValue({ id: "period" });
    if (kind === "overlap") mocks.entryOther.mockResolvedValue({ id: "other" });
    if (kind === "changed schedule") mocks.schedules.mockResolvedValue([]);
    expect(await decideProposal(actor, { id: "proposal", action: "APPROVE", confirmedActualEnd: true })).toMatchObject({ ok: false });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(proposal.status).toBe("PENDING");
  });
  it("undoes only an unchanged applied entry, restoring its original open state", async () => {
    const original = structuredClone(entry);
    await decideProposal(actor, { id: "proposal", action: "APPROVE", confirmedActualEnd: true });
    expect(await decideProposal(actor, { id: "proposal", action: "UNDO" })).toMatchObject({ ok: true, status: "UNDONE" });
    expect(entry).toMatchObject({ clockOut: original.clockOut, status: original.status, totalWorkMin: original.totalWorkMin, editReason: original.editReason });
    expect(entry.updatedAt).not.toBe(original.updatedAt);
    await decideProposal(actor, { id: "proposal", action: "UNDO" });
    expect(mocks.entryUpdate).toHaveBeenCalledTimes(1);
  });
  it("refuses unsafe undo after another edit or later punch", async () => {
    await decideProposal(actor, { id: "proposal", action: "APPROVE", confirmedActualEnd: true });
    mocks.entryOther.mockResolvedValue({ id: "later" });
    expect(await decideProposal(actor, { id: "proposal", action: "UNDO" })).toMatchObject({ ok: false, error: expect.stringContaining("overlaps") });
    expect(mocks.entryUpdate).not.toHaveBeenCalled();
    entry.editReason = "Later edit";
    expect(await decideProposal(actor, { id: "proposal", action: "UNDO" })).toMatchObject({ ok: false, error: expect.stringContaining("changed") });
  });
  it("rechecks admin access inside the transaction and does not log revoked users", async () => {
    mocks.user.mockResolvedValue({ role: "EMPLOYEE", employee: null });
    expect(await decideProposal(actor, { id: "proposal", action: "APPROVE", confirmedActualEnd: true })).toMatchObject({ ok: false });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.proposalUpdate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});


describe("automatic missing-clock-out drafts", () => {
  const now = new Date("2026-10-02T00:00:00Z");
  beforeEach(() => { mocks.proposal.mockResolvedValue(null); });

  it("creates only a pending draft with system attribution and no punch changes", async () => {
    expect(await queueAutomaticClockOutProposals(now)).toEqual({ created: 1, skipped: 0, errors: [] });
    expect(mocks.findings).toHaveBeenCalledWith(expect.objectContaining({ where: { ruleId: "time.missing-clock-out", subjectType: "TimeEntry", status: { in: ["OPEN", "ACKNOWLEDGED"] } } }));
    expect(mocks.proposalCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ createdById: null, proposedClockOut: end, before: expect.objectContaining({ clockOut: null }) }) });
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: null, actorEmail: "system:watch", action: "watch.proposal.create", diff: expect.objectContaining({ automatic: true }) }) });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.entryUpdate).not.toHaveBeenCalled();
    expect(mocks.proposalUpdate).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "REJECTED", "APPLIED", "UNDONE"])("does not recreate an entry's %s proposal", async (status) => {
    mocks.proposal.mockResolvedValue({ ...proposal, status });
    expect(await queueAutomaticClockOutProposals(now)).toEqual({ created: 0, skipped: 1, errors: [] });
    expect(mocks.proposal).toHaveBeenCalledWith({ where: { entryId: "entry" } });
    expect(mocks.proposalCreate).not.toHaveBeenCalled();
    expect(mocks.proposalUpdate).not.toHaveBeenCalled();
  });

  it.each(["closed shift", "open break", "missing schedule", "ambiguous schedules", "future scheduled end", "closed period", "overlap", "invalid break", "dismissed finding", "snoozed finding"])("skips ineligible %s without error or business writes", async (kind) => {
    if (kind === "closed shift") entry.clockOut = end;
    if (kind === "open break") entry.breaks = [{ id: "break", startTime: start, endTime: null }];
    if (kind === "missing schedule") mocks.schedules.mockResolvedValue([]);
    if (kind === "ambiguous schedules") {
      const schedule = { id: "schedule", date: new Date("2026-10-01"), startTime: "08:00", endTime: "16:00", updatedAt: start };
      mocks.schedules.mockResolvedValue([schedule, { ...schedule, id: "second" }]);
    }
    if (kind === "closed period") mocks.period.mockResolvedValue({ id: "closed" });
    if (kind === "overlap") mocks.entryOther.mockResolvedValue({ id: "other" });
    if (kind === "invalid break") entry.breaks = [{ id: "break", startTime: new Date(start.getTime() - 60_000), endTime: end }];
    if (kind === "dismissed finding" || kind === "snoozed finding") mocks.finding.mockResolvedValue({ id: "finding", ruleId: "time.missing-clock-out", subjectType: "TimeEntry", subjectId: "entry", status: kind === "dismissed finding" ? "DISMISSED" : "SNOOZED" });
    const result = await queueAutomaticClockOutProposals(kind === "future scheduled end" ? start : now);
    expect(result).toEqual({ created: 0, skipped: 1, errors: [] });
    expect(mocks.proposalCreate).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.entryUpdate).not.toHaveBeenCalled();
  });

  it("serializes simultaneous generation and does not replace the first snapshot", async () => {
    let saved: object | null = null;
    let serial = Promise.resolve();
    mocks.proposal.mockImplementation(async () => saved);
    mocks.proposalCreate.mockImplementation(async ({ data }) => { saved = { id: "proposal", ...data }; return saved; });
    mocks.lock.mockImplementation((_id, callback) => {
      const result = serial.then(() => callback(tx));
      serial = result.then(() => undefined);
      return result;
    });
    const results = await Promise.all([queueAutomaticClockOutProposals(now), queueAutomaticClockOutProposals(now)]);
    expect(results.reduce((sum, r) => sum + r.created, 0)).toBe(1);
    expect(results.reduce((sum, r) => sum + r.skipped, 0)).toBe(1);
    expect(mocks.proposalCreate).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.proposalUpdate).not.toHaveBeenCalled();
  });

  it("reports unexpected persistence failures instead of counting them as skips", async () => {
    mocks.audit.mockRejectedValue(new Error("Audit unavailable"));
    expect(await queueAutomaticClockOutProposals(now)).toEqual({ created: 0, skipped: 0, errors: ["finding: Audit unavailable"] });
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
