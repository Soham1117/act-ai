import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { accessLevelFor } from "@/lib/access";
import { fail, failFromUnknown, ok, type ActionResult } from "@/lib/action-result";
import { ADMIN_MAX_SHIFT_MS, validateEntryTimes } from "@/lib/time-rules";
import { proposalEntrySnapshot, scheduledClockOut, snapshotsMatch } from "@/lib/watch/proposals";
import { closeOpenEntry, withEmployeeLock, type Tx } from "@/server/time-core";

type Actor = { id: string; email: string | null };
type Decision = "APPROVE" | "REJECT" | "UNDO";

async function assertActor(tx: Tx, actor: Actor) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Employee" WHERE "userId" = ${actor.id}::uuid FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: actor.id }, include: { employee: true } });
  if (!user || user.role !== "ADMIN" || accessLevelFor(user) !== "FULL") throw new Error("You no longer have permission to review Watch proposals.");
}

async function log(tx: Tx, actor: Actor | null, id: string, action: string, diff: Prisma.InputJsonObject) {
  await tx.auditLog.create({ data: { actorId: actor?.id ?? null, actorEmail: actor ? actor.email : "system:watch", action: `watch.proposal.${action}`, resource: `WatchProposal:${id}`, diff } });
}

/** Row locks serialize proposal execution against payroll close/reopen. */
async function assertOpenPeriod(tx: Tx, date: Date) {
  await tx.$queryRaw`SELECT id FROM "PayrollCalendar" WHERE "payPeriodStart" <= ${date} AND "payPeriodEnd" >= ${date} FOR UPDATE`;
  const closed = await tx.payrollCalendar.findFirst({ where: { closedAt: { not: null }, payPeriodStart: { lte: date }, payPeriodEnd: { gte: date } }, select: { id: true } });
  if (closed) throw new Error("This entry belongs to a closed pay period. Reopen the period before changing hours.");
}

/** Shared draft-only path. A null actor is reserved for the internal scheduled runner. */
async function createDraft(actor: Actor | null, input: { findingId: string; reason: string }, now: Date): Promise<ActionResult<{ id: string; created: boolean }>> {
  const finding = await db.watchFinding.findUnique({ where: { id: input.findingId } });
  if (!finding || finding.ruleId !== "time.missing-clock-out" || finding.subjectType !== "TimeEntry") return fail("Choose an employee missing-clock-out finding.");
  const found = await db.timeEntry.findUnique({ where: { id: finding.subjectId }, select: { employeeId: true } });
  if (!found) return fail("That time entry no longer exists.");
  return withEmployeeLock(found.employeeId, async (tx) => {
    if (actor) await assertActor(tx, actor);
    const currentFinding = await tx.watchFinding.findUnique({ where: { id: finding.id } });
    const statuses = actor ? ["OPEN", "ACKNOWLEDGED", "SNOOZED"] : ["OPEN", "ACKNOWLEDGED"];
    if (!currentFinding || !statuses.includes(currentFinding.status) || currentFinding.ruleId !== finding.ruleId || currentFinding.subjectType !== "TimeEntry" || currentFinding.subjectId !== finding.subjectId) return fail("This flag changed. Refresh and review it again.");
    const entry = await tx.timeEntry.findUnique({ where: { id: finding.subjectId }, include: { breaks: true } });
    if (!entry || entry.clockOut || !["ACTIVE", "ON_BREAK"].includes(entry.status)) return fail("This shift is already closed.");
    if (entry.breaks.some((b) => !b.endTime)) return fail("This shift has an open break. Confirm the break end in Hours before drafting a correction.");
    // A scheduled run never recreates a rejected/undone proposal or refreshes a
    // stale pending draft. An admin can deliberately create a new draft instead.
    const existing = await tx.watchProposal.findFirst({ where: { entryId: entry.id, ...(actor ? { status: "PENDING" as const } : {}) } });
    if (existing) return ok({ id: existing.id, created: false });
    await tx.$queryRaw`SELECT id FROM "Schedule" WHERE "employeeId" = ${entry.employeeId} AND date = ${entry.date} FOR SHARE`;
    const schedules = await tx.schedule.findMany({ where: { employeeId: entry.employeeId, date: entry.date } });
    const suggested = scheduledClockOut(entry, schedules, now);
    if (!suggested) return fail("There is no single valid scheduled end for this shift. Confirm the actual clock-out in Hours instead.");
    await tx.$queryRaw`SELECT id FROM "PayrollCalendar" WHERE "payPeriodStart" <= ${entry.date} AND "payPeriodEnd" >= ${entry.date} FOR UPDATE`;
    const closed = await tx.payrollCalendar.findFirst({ where: { closedAt: { not: null }, payPeriodStart: { lte: entry.date }, payPeriodEnd: { gte: entry.date } }, select: { id: true } });
    if (closed) return fail("This entry belongs to a closed pay period. Reopen the period before drafting a correction.");
    const invalid = validateEntryTimes({ clockIn: entry.clockIn, clockOut: suggested.clockOut, breaks: entry.breaks, maxShiftMs: ADMIN_MAX_SHIFT_MS, now });
    if (invalid) return fail(invalid);
    const overlap = await tx.timeEntry.findFirst({ where: { employeeId: entry.employeeId, id: { not: entry.id }, approvalStatus: { not: "REJECTED" }, clockIn: { lt: suggested.clockOut }, OR: [{ clockOut: null }, { clockOut: { gt: entry.clockIn } }] }, select: { id: true } });
    if (overlap) return fail("The proposed correction overlaps another time entry.");
    const before = proposalEntrySnapshot(entry);
    const evidence = { scheduleId: suggested.scheduleId, scheduleUpdatedAt: suggested.scheduleUpdatedAt, scheduledEnd: suggested.clockOut.toISOString(), warning: "Scheduled time is a suggestion, not proof of time worked. Confirm the actual end before approval." };
    const proposal = await tx.watchProposal.create({ data: { findingId: finding.id, entryId: entry.id, employeeId: entry.employeeId, before, proposedClockOut: suggested.clockOut, reason: input.reason, evidence, createdById: actor?.id ?? null } });
    await log(tx, actor, proposal.id, "create", { findingId: finding.id, before, proposedClockOut: suggested.clockOut.toISOString(), reason: input.reason, evidence, automatic: actor === null });
    return ok({ id: proposal.id, created: true });
  });
}

export async function createProposal(actor: Actor, input: { findingId: string; reason: string }): Promise<ActionResult<{ id: string }>> {
  try {
    const result = await createDraft(actor, input, new Date());
    return result.ok ? ok({ id: result.id }) : result;
  } catch (error) { return failFromUnknown(error); }
}

/** Internal L3 generation only: never closes, approves or changes a punch. */
export async function queueAutomaticClockOutProposals(now: Date): Promise<{ created: number; skipped: number; errors: string[] }> {
  const findings = await db.watchFinding.findMany({
    where: { ruleId: "time.missing-clock-out", subjectType: "TimeEntry", status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    select: { id: true },
    orderBy: { firstSeenAt: "asc" },
  });
  const counts = { created: 0, skipped: 0, errors: [] as string[] };
  for (const finding of findings) {
    try {
      const result = await createDraft(null, { findingId: finding.id, reason: "Watch detected a missing clock-out. The scheduled end is a draft suggestion; an admin must verify the actual end of work." }, now);
      if (result.ok && result.created) counts.created++;
      else counts.skipped++;
    } catch (error) {
      counts.errors.push(`${finding.id}: ${failFromUnknown(error).error}`.slice(0, 500));
    }
  }
  return counts;
}

export async function decideProposal(actor: Actor, input: { id: string; action: Decision; confirmedActualEnd?: boolean }): Promise<ActionResult<{ id: string; status: string }>> {
  let employeeId: string | null = null;
  try {
    const found = await db.watchProposal.findUnique({ where: { id: input.id }, select: { employeeId: true } });
    if (!found) return fail("That proposal no longer exists.");
    employeeId = found.employeeId;
    return await withEmployeeLock(found.employeeId, async (tx) => {
      await assertActor(tx, actor);
      const proposal = await tx.watchProposal.findUniqueOrThrow({ where: { id: input.id } });
      if (input.action === "APPROVE" && input.confirmedActualEnd !== true) return fail("Confirm that the proposed clock-out is the actual time worked before applying this correction.");
      if ((input.action === "APPROVE" && proposal.status === "APPLIED") || (input.action === "REJECT" && proposal.status === "REJECTED") || (input.action === "UNDO" && proposal.status === "UNDONE")) return ok({ id: proposal.id, status: proposal.status });
      if ((input.action === "UNDO" ? proposal.status !== "APPLIED" : proposal.status !== "PENDING")) return fail("That action no longer applies to this proposal.");
      if (input.action === "REJECT") {
        await tx.watchProposal.update({ where: { id: proposal.id }, data: { status: "REJECTED", decidedById: actor.id, decidedAt: new Date(), lastError: null } });
        await log(tx, actor, proposal.id, "reject", { entryId: proposal.entryId, reason: proposal.reason });
        return ok({ id: proposal.id, status: "REJECTED" });
      }
      const entry = await tx.timeEntry.findUnique({ where: { id: proposal.entryId }, include: { breaks: true } });
      if (!entry) throw new Error("The original time entry no longer exists.");
      const before = proposalEntrySnapshot(entry);
      const expected = input.action === "UNDO" ? proposal.after : proposal.before;
      if (!snapshotsMatch(before, expected)) throw new Error("This entry changed after the proposal was reviewed. Reject it and create a fresh proposal.");
      await assertOpenPeriod(tx, entry.date);
      if (input.action === "APPROVE") {
        if (entry.clockOut || !["ACTIVE", "ON_BREAK"].includes(entry.status)) throw new Error("This shift is already closed.");
        if (entry.breaks.some((b) => !b.endTime)) throw new Error("An open break must be corrected separately before approval.");
        await tx.$queryRaw`SELECT id FROM "Schedule" WHERE "employeeId" = ${entry.employeeId} AND date = ${entry.date} FOR SHARE`;
        const schedules = await tx.schedule.findMany({ where: { employeeId: entry.employeeId, date: entry.date } });
        const suggested = scheduledClockOut(entry, schedules, new Date());
        const evidence = proposal.evidence as Record<string, unknown>;
        if (!suggested || suggested.scheduleId !== evidence.scheduleId || suggested.scheduleUpdatedAt !== evidence.scheduleUpdatedAt || suggested.clockOut.getTime() !== proposal.proposedClockOut.getTime()) throw new Error("The schedule evidence changed. Reject this proposal and create a fresh one.");
        const invalid = validateEntryTimes({ clockIn: entry.clockIn, clockOut: proposal.proposedClockOut, breaks: entry.breaks, maxShiftMs: ADMIN_MAX_SHIFT_MS });
        if (invalid) throw new Error(invalid);
        const overlap = await tx.timeEntry.findFirst({ where: { employeeId: entry.employeeId, id: { not: entry.id }, approvalStatus: { not: "REJECTED" }, clockIn: { lt: proposal.proposedClockOut }, OR: [{ clockOut: null }, { clockOut: { gt: entry.clockIn } }] }, select: { id: true } });
        if (overlap) throw new Error("The proposed correction overlaps another time entry.");
        await closeOpenEntry(tx, entry, proposal.proposedClockOut, { autoClosed: false, lastEditedById: actor.id, editReason: `Watch correction: ${proposal.reason}`, approvalNotes: null }, ADMIN_MAX_SHIFT_MS);
      } else {
        // No break rows are changed by this action. Exact snapshot matching above
        // protects them, and the full entry, from undoing intervening edits.
        const overlap = await tx.timeEntry.findFirst({ where: { employeeId: entry.employeeId, id: { not: entry.id }, approvalStatus: { not: "REJECTED" }, OR: [{ clockOut: null }, { clockOut: { gt: entry.clockIn } }] }, select: { id: true } });
        if (overlap) throw new Error("Undo would reopen a shift that overlaps another entry. Correct it in Hours instead.");
        const original = proposal.before as Record<string, Prisma.InputJsonValue>;
        await tx.timeEntry.update({ where: { id: entry.id }, data: {
          clockOut: original.clockOut ? new Date(String(original.clockOut)) : null,
          status: original.status as "ACTIVE" | "ON_BREAK",
          approvalStatus: original.approvalStatus as "PENDING" | "APPROVED" | "REJECTED",
          approvedById: original.approvedById as string | null,
          approvalDate: original.approvalDate ? new Date(String(original.approvalDate)) : null,
          approvalNotes: original.approvalNotes as string | null,
          totalWorkMin: Number(original.totalWorkMin), totalBreakMin: Number(original.totalBreakMin),
          autoClosed: Boolean(original.autoClosed), lastEditedById: original.lastEditedById as string | null,
          editReason: original.editReason as string | null,
        } });
      }
      const after = proposalEntrySnapshot(await tx.timeEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { breaks: true } }));
      const status = input.action === "APPROVE" ? "APPLIED" : "UNDONE";
      await tx.watchProposal.update({ where: { id: proposal.id }, data: { status, ...(status === "APPLIED" ? { after } : {}), decidedById: actor.id, decidedAt: new Date(), lastError: null } });
      await log(tx, actor, proposal.id, input.action === "APPROVE" ? "apply" : "undo", { entryId: entry.id, before, after, reason: proposal.reason });
      return ok({ id: proposal.id, status });
    });
  } catch (error) {
    const failure = failFromUnknown(error);
    if (employeeId) {
      try {
        await withEmployeeLock(employeeId, async (tx) => {
          await assertActor(tx, actor);
          const proposal = await tx.watchProposal.findUnique({ where: { id: input.id } });
          if (!proposal || proposal.status !== (input.action === "UNDO" ? "APPLIED" : "PENDING")) return;
          await tx.watchProposal.update({ where: { id: input.id }, data: { lastError: failure.error } });
          await log(tx, actor, input.id, "failed", { action: input.action, error: failure.error, status: proposal.status });
        });
      } catch { /* A revoked caller must not write an error onto a proposal. */ }
    }
    return failure;
  }
}
