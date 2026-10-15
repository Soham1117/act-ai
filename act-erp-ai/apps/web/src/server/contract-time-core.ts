/**
 * Core punch logic for contract workers (agency staff), shared by the kiosk
 * and admin tools. Mirrors `time-core.ts` but runs against the separate
 * ContractWorker / ContractTimeEntry tables, so contract hours can never
 * reach payroll, leave, benefits or headcount.
 *
 * Deliberately NOT a "use server" module: everything exported from a
 * "use server" file becomes a public endpoint, and these helpers take a bare
 * contract worker id with no authentication. Only call them from code that
 * has already authenticated the caller (active kiosk session, or an admin).
 */
import { revalidatePath } from "next/cache";
import type {
  ContractTimeBreak,
  ContractTimeEntry,
  Prisma,
  TimeEntryStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyAdmins } from "@/lib/notify";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { businessDateOnly } from "@/lib/format";
import { contractWorkerIneligibleReason } from "@/lib/contract-workers";
import {
  MAX_SHIFT_MINUTES,
  breakMinutes,
  computeEntryTotals,
  isStaleShift,
} from "@/lib/time-rules";

export type Tx = Prisma.TransactionClient;
export type ContractEntryWithBreaks = ContractTimeEntry & { breaks: ContractTimeBreak[] };

export const CONTRACT_AUTO_CLOSE_REASON = `Auto-closed: shift ran longer than ${MAX_SHIFT_MINUTES / 60} hours (counted time capped). Needs admin review.`;

const DEFAULT_JOB_CODE = "ACT001";

/**
 * Run `fn` in a transaction holding a per-worker advisory lock so punches,
 * breaks and admin edits for one contract worker are fully serialized. The
 * key is prefixed so it can never collide with an employee lock.
 */
export async function withContractWorkerLock<T>(
  contractWorkerId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('contract:' || ${contractWorkerId}))`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

export function revalidateContractPages() {
  revalidatePath("/admin/contract-workers");
}

/**
 * Close an open entry at `requestedEnd` (capped at the max shift length).
 * Open breaks are closed at the effective end. Flags the entry `autoClosed`
 * when the cap kicked in. Must run inside {@link withContractWorkerLock}.
 */
export async function closeOpenContractEntry(
  tx: Tx,
  entry: ContractEntryWithBreaks,
  requestedEnd: Date,
  extra: Prisma.ContractTimeEntryUncheckedUpdateInput = {},
): Promise<{ entry: ContractTimeEntry; capped: boolean }> {
  const totals = computeEntryTotals({
    clockIn: entry.clockIn,
    clockOut: requestedEnd,
    breaks: entry.breaks,
  });
  const end = totals.effectiveClockOut;

  for (const b of entry.breaks) {
    if (b.endTime) continue;
    const bEnd = end.getTime() < b.startTime.getTime() ? b.startTime : end;
    await tx.contractTimeBreak.update({
      where: { id: b.id },
      data: { endTime: bEnd, durationMin: breakMinutes(b, entry.clockIn, end) },
    });
  }

  const updated = await tx.contractTimeEntry.update({
    where: { id: entry.id },
    data: {
      clockOut: end,
      status: "COMPLETED" as TimeEntryStatus,
      approvalStatus: "PENDING",
      approvedById: null,
      approvedByName: null,
      approvalDate: null,
      totalBreakMin: totals.totalBreakMin,
      totalWorkMin: totals.totalWorkMin,
      ...(totals.capped ? { autoClosed: true, editReason: CONTRACT_AUTO_CLOSE_REASON } : {}),
      ...extra,
    },
  });
  return { entry: updated, capped: totals.capped };
}

/** Audit + notify admins (only; contract workers have no portal) about auto-closed shifts. */
export async function reportContractAutoClosed(
  contractWorkerId: string,
  entryIds: string[],
  trigger: string,
) {
  if (entryIds.length === 0) return;
  const worker = await db.contractWorker.findUnique({
    where: { id: contractWorkerId },
    select: { name: true, workerId: true },
  });
  const name = worker ? `${worker.name} (${worker.workerId})` : "A contract worker";
  for (const id of entryIds) {
    await audit({
      action: "contract.time.auto_close",
      resource: `ContractTimeEntry:${id}`,
      actor: { id: null, email: "system:auto-close" },
      diff: { contractWorkerId, trigger, maxShiftHours: MAX_SHIFT_MINUTES / 60 },
    });
  }
  await notifyAdmins({
    type: "TIME",
    title: "Contract shift auto-closed for review",
    message: `${name}'s shift ran past ${MAX_SHIFT_MINUTES / 60} hours and was closed automatically. Review it under Contract workers > Hours.`,
    link: "/admin/contract-workers?tab=hours",
    priority: "HIGH",
  });
}

export type ContractPunchResult = ActionResult<{
  id: string;
  status: string;
  autoClosed?: boolean;
}>;

type KioskMeta = { kioskSlug?: string | null; kioskLabel?: string | null };

export async function _contractClockIn(
  contractWorkerId: string,
  kiosk?: KioskMeta,
): Promise<ContractPunchResult> {
  try {
    const outcome = await withContractWorkerLock(contractWorkerId, async (tx) => {
      const worker = await tx.contractWorker.findUnique({
        where: { id: contractWorkerId },
        select: { status: true, startDate: true, endDate: true, jobCode: true },
      });
      if (!worker) return { kind: "missing" as const };
      const now = new Date();
      const today = businessDateOnly(now);
      const reason = contractWorkerIneligibleReason(worker, today);
      if (reason) return { kind: "ineligible" as const, reason };

      const open = await tx.contractTimeEntry.findMany({
        where: { contractWorkerId, status: { in: ["ACTIVE", "ON_BREAK"] } },
        include: { breaks: true },
      });
      if (open.some((e) => !isStaleShift(e.clockIn, now))) {
        return { kind: "already" as const };
      }
      const closedIds: string[] = [];
      for (const stale of open) {
        await closeOpenContractEntry(tx, stale, now);
        closedIds.push(stale.id);
      }
      const entry = await tx.contractTimeEntry.create({
        data: {
          contractWorkerId,
          date: today,
          clockIn: now,
          jobCode: worker.jobCode ?? DEFAULT_JOB_CODE,
          status: "ACTIVE" as TimeEntryStatus,
          kioskSlug: kiosk?.kioskSlug ?? null,
          kioskLabel: kiosk?.kioskLabel ?? null,
        },
      });
      return { kind: "ok" as const, entry, closedIds };
    });

    if (outcome.kind === "missing") {
      return fail("That contract worker was not found. Refresh the kiosk and try again.");
    }
    if (outcome.kind === "ineligible") return fail(outcome.reason);
    if (outcome.kind === "already") {
      return fail("You are already clocked in. Clock out first, or refresh if this looks wrong.");
    }
    await reportContractAutoClosed(contractWorkerId, outcome.closedIds, "clock_in");
    revalidateContractPages();
    return ok({
      id: outcome.entry.id,
      status: outcome.entry.status,
      autoClosed: outcome.closedIds.length > 0,
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Clock-out is allowed even after the contract end date, so nobody is left clocked in. */
export async function _contractClockOut(
  contractWorkerId: string,
  kiosk?: KioskMeta,
): Promise<ContractPunchResult> {
  try {
    const outcome = await withContractWorkerLock(contractWorkerId, async (tx) => {
      const entry = await tx.contractTimeEntry.findFirst({
        where: { contractWorkerId, status: { in: ["ACTIVE", "ON_BREAK"] } },
        orderBy: { clockIn: "desc" },
        include: { breaks: true },
      });
      if (!entry) return null;
      return closeOpenContractEntry(tx, entry, new Date(), {
        kioskSlug: kiosk?.kioskSlug ?? entry.kioskSlug,
        kioskLabel: kiosk?.kioskLabel ?? entry.kioskLabel,
      });
    });
    if (!outcome) {
      return fail("You are not clocked in. Refresh the kiosk and try again.");
    }
    if (outcome.capped) {
      await reportContractAutoClosed(contractWorkerId, [outcome.entry.id], "clock_out");
    }
    revalidateContractPages();
    return ok({
      id: outcome.entry.id,
      status: outcome.entry.status,
      autoClosed: outcome.capped,
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function _contractStartBreak(contractWorkerId: string): Promise<ContractPunchResult> {
  try {
    const outcome = await withContractWorkerLock(contractWorkerId, async (tx) => {
      const entry = await tx.contractTimeEntry.findFirst({
        where: { contractWorkerId, status: { in: ["ACTIVE", "ON_BREAK"] } },
        orderBy: { clockIn: "desc" },
      });
      if (!entry || entry.status !== "ACTIVE") return { kind: "notActive" as const };
      if (isStaleShift(entry.clockIn)) return { kind: "stale" as const };
      const now = new Date();
      await tx.contractTimeBreak.create({
        data: { timeEntryId: entry.id, startTime: now, type: "BREAK" },
      });
      const updated = await tx.contractTimeEntry.update({
        where: { id: entry.id },
        data: { status: "ON_BREAK" as TimeEntryStatus },
      });
      return { kind: "ok" as const, updated };
    });
    if (outcome.kind === "notActive") {
      return fail("You are not currently clocked in. Clock in first, then start a break.");
    }
    if (outcome.kind === "stale") {
      return fail(
        `Your shift has been open more than ${MAX_SHIFT_MINUTES / 60} hours. Clock out to close it, then clock in again.`,
      );
    }
    revalidateContractPages();
    return ok({ id: outcome.updated.id, status: outcome.updated.status });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function _contractEndBreak(contractWorkerId: string): Promise<ContractPunchResult> {
  try {
    const outcome = await withContractWorkerLock(contractWorkerId, async (tx) => {
      const entry = await tx.contractTimeEntry.findFirst({
        where: { contractWorkerId, status: "ON_BREAK" },
        orderBy: { clockIn: "desc" },
        include: { breaks: { where: { endTime: null } } },
      });
      if (!entry) return { kind: "notOnBreak" as const };
      if (isStaleShift(entry.clockIn)) return { kind: "stale" as const };
      const open = entry.breaks[0];
      if (!open) return { kind: "noBreak" as const };
      const now = new Date();
      const dur = Math.max(0, Math.floor((now.getTime() - open.startTime.getTime()) / 60_000));
      await tx.contractTimeBreak.update({
        where: { id: open.id },
        data: { endTime: now, durationMin: dur },
      });
      const updated = await tx.contractTimeEntry.update({
        where: { id: entry.id },
        data: { status: "ACTIVE" as TimeEntryStatus, totalBreakMin: { increment: dur } },
      });
      return { kind: "ok" as const, updated };
    });
    if (outcome.kind === "notOnBreak") {
      return fail("You are not on break. Refresh the kiosk and try again.");
    }
    if (outcome.kind === "noBreak") {
      return fail("No open break was found on this session. Refresh the kiosk and try again.");
    }
    if (outcome.kind === "stale") {
      return fail(
        `Your shift has been open more than ${MAX_SHIFT_MINUTES / 60} hours. Clock out to close it, then clock in again.`,
      );
    }
    revalidateContractPages();
    return ok({ id: outcome.updated.id, status: outcome.updated.status });
  } catch (err) {
    return failFromUnknown(err);
  }
}
