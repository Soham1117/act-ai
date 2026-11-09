import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  finding: vi.fn(), entry: vi.fn(), entryOrThrow: vi.fn(), entryOther: vi.fn(), entryUpdate: vi.fn(),
  proposal: vi.fn(), proposalCreate: vi.fn(), proposalUpdate: vi.fn(), schedules: vi.fn(),
  user: vi.fn(), period: vi.fn(), query: vi.fn(), audit: vi.fn(), close: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  watchFinding: { findUnique: mocks.finding }, timeEntry: { findUnique: mocks.entry }, watchProposal: { findUnique: mocks.proposal },
} }));
vi.mock("@/server/time-core", () => ({ withEmployeeLock: mocks.lock, closeOpenEntry: mocks.close }));

import { createProposal, decideProposal } from "./proposals";
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
