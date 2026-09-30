/**
 * Core punch logic shared by the kiosk and admin tools.
 *
 * Deliberately NOT a "use server" module: everything exported from a
 * "use server" file becomes a public endpoint, and these helpers take a bare
 * employeeId with no authentication. Only call them from code that has
 * already authenticated the caller (kiosk session + PIN, or an admin).
 */
import { revalidatePath } from "next/cache";
import type { Prisma, TimeBreak, TimeEntry, TimeEntryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyAdmins, notifyEmployees } from "@/lib/notify";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { businessDateOnly } from "@/lib/format";
import {
  MAX_SHIFT_MINUTES,
  breakMinutes,
  computeEntryTotals,
  isStaleShift,
} from "@/lib/time-rules";

export type Tx = Prisma.TransactionClient;
type EntryWithBreaks = TimeEntry & { breaks: TimeBreak[] };

export const AUTO_CLOSE_REASON = `Auto-closed: shift ran longer than ${MAX_SHIFT_MINUTES / 60} hours (counted time capped). Needs admin review.`;

/**
 * Run `fn` in a transaction holding a per-employee advisory lock so punches,
 * breaks and admin edits for one employee are fully serialized.
 */
export async function withEmployeeLock<T>(
  employeeId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${employeeId}))`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

export function revalidateTimePages() {
  revalidatePath("/dashboard/time-tracking");
  revalidatePath("/admin/time-tracking");
  revalidatePath("/admin");
}

/** Resolve the best job code for an employee using the legacy 5-tier resolver. */
async function resolveJobCode(tx: Tx, employeeId: string): Promise<string> {
  const primaryAssignment = await tx.jobCodeAssignment.findFirst({
    where: { employeeId, isPrimary: true, jobCode: { isActive: true } },
    include: { jobCode: true },
  });
  if (primaryAssignment) return primaryAssignment.jobCode.code;

  const anyAssignment = await tx.jobCodeAssignment.findFirst({
    where: { employeeId, jobCode: { isActive: true } },
    include: { jobCode: true },
  });
  if (anyAssignment) return anyAssignment.jobCode.code;

  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    include: { primaryJobCode: true },
  });
  if (employee?.primaryJobCode?.isActive) return employee.primaryJobCode.code;

  const def = await tx.jobCode.findFirst({ where: { isDefault: true, isActive: true } });
  if (def) return def.code;

  return "ACT001";
}

/**
 * Close an open entry at `requestedEnd` (capped at the max shift length).
 * Open breaks are closed at the effective end. Flags the entry `autoClosed`
 * when the cap kicked in. Must run inside {@link withEmployeeLock}.
 */
export async function closeOpenEntry(
  tx: Tx,
  entry: EntryWithBreaks,
  requestedEnd: Date,
  extra: Prisma.TimeEntryUncheckedUpdateInput = {},
): Promise<{ entry: TimeEntry; capped: boolean }> {
  const totals = computeEntryTotals({
    clockIn: entry.clockIn,
    clockOut: requestedEnd,
    breaks: entry.breaks,
  });
  const end = totals.effectiveClockOut;

  for (const b of entry.breaks) {
    if (b.endTime) continue;
    const bEnd = end.getTime() < b.startTime.getTime() ? b.startTime : end;
    await tx.timeBreak.update({
      where: { id: b.id },
      data: { endTime: bEnd, durationMin: breakMinutes(b, entry.clockIn, end) },
    });
  }

  const updated = await tx.timeEntry.update({
    where: { id: entry.id },
    data: {
      clockOut: end,
      status: "COMPLETED" as TimeEntryStatus,
      approvalStatus: "PENDING",
      approvedById: null,
      approvalDate: null,
      totalBreakMin: totals.totalBreakMin,
      totalWorkMin: totals.totalWorkMin,
      ...(totals.capped ? { autoClosed: true, editReason: AUTO_CLOSE_REASON } : {}),
      ...extra,
    },
  });
  return { entry: updated, capped: totals.capped };
}

async function reportAutoClosed(employeeId: string, entryIds: string[], trigger: string) {
  if (entryIds.length === 0) return;
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { name: true },
  });
  const name = emp?.name ?? "An employee";
  for (const id of entryIds) {
    await audit({
      action: "time.auto_close",
      resource: `TimeEntry:${id}`,
      actor: { id: null, email: "system:auto-close" },
      diff: { employeeId, trigger, maxShiftHours: MAX_SHIFT_MINUTES / 60 },
    });
  }
  await notifyAdmins({
    type: "TIME",
    title: "Shift auto-closed for review",
    message: `${name}'s shift ran past ${MAX_SHIFT_MINUTES / 60} hours and was closed automatically. Review it under Time tracking > Needs attention.`,
    link: "/admin/time-tracking?tab=attention",
    priority: "HIGH",
  });
  await notifyEmployees([employeeId], {
    type: "TIME",
    title: "A previous shift was left open",
    message: `Your earlier shift ran past ${MAX_SHIFT_MINUTES / 60} hours and was closed automatically. An admin will review the hours.`,
    link: "/dashboard/time-tracking",
  });
}

export type PunchResult = ActionResult<{ id: string; status: string; autoClosed?: boolean }>;

export async function _clockIn(
  employeeId: string,
  jobCode?: string,
  source: "WEB" | "KIOSK" = "WEB",
  kiosk?: { kioskSlug?: string | null; kioskLabel?: string | null },
): Promise<PunchResult> {
  try {
    const outcome = await withEmployeeLock(employeeId, async (tx) => {
      const employee = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { employmentStatus: true },
      });
      if (!employee || employee.employmentStatus !== "ACTIVE") {
        return { kind: "inactive" as const };
      }
      const now = new Date();
      const open = await tx.timeEntry.findMany({
        where: { employeeId, status: { in: ["ACTIVE", "ON_BREAK"] } },
        include: { breaks: true },
      });
      if (open.some((e) => !isStaleShift(e.clockIn, now))) {
        return { kind: "already" as const };
      }
      const closedIds: string[] = [];
      for (const stale of open) {
        await closeOpenEntry(tx, stale, now);
        closedIds.push(stale.id);
      }
      const code = jobCode ?? (await resolveJobCode(tx, employeeId));
      const entry = await tx.timeEntry.create({
        data: {
          employeeId,
          date: businessDateOnly(now),
          clockIn: now,
          jobCode: code,
          status: "ACTIVE" as TimeEntryStatus,
          source,
          kioskSlug: kiosk?.kioskSlug ?? null,
          kioskLabel: kiosk?.kioskLabel ?? null,
        },
      });
      return { kind: "ok" as const, entry, closedIds };
    });

    if (outcome.kind === "inactive") {
      return fail("This account isn't active for time clock use. Please see an admin.");
    }
    if (outcome.kind === "already") {
      return fail("You are already clocked in. Clock out first, or refresh if this looks wrong.");
    }
    await reportAutoClosed(employeeId, outcome.closedIds, "clock_in");
    revalidateTimePages();
    return ok({
      id: outcome.entry.id,
      status: outcome.entry.status,
      autoClosed: outcome.closedIds.length > 0,
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function _clockOut(
  employeeId: string,
  notes?: string,
  kiosk?: { kioskSlug?: string | null; kioskLabel?: string | null },
): Promise<PunchResult> {
  try {
    const outcome = await withEmployeeLock(employeeId, async (tx) => {
      const entry = await tx.timeEntry.findFirst({
        where: { employeeId, status: { in: ["ACTIVE", "ON_BREAK"] } },
        orderBy: { clockIn: "desc" },
        include: { breaks: true },
      });
      if (!entry) return null;
      const res = await closeOpenEntry(tx, entry, new Date(), {
        timesheetNotes: notes ?? entry.timesheetNotes,
        kioskSlug: kiosk?.kioskSlug ?? entry.kioskSlug,
        kioskLabel: kiosk?.kioskLabel ?? entry.kioskLabel,
      });
      return res;
    });
    if (!outcome) {
      return fail("You are not clocked in. Refresh the kiosk and try again.");
    }
    if (outcome.capped) await reportAutoClosed(employeeId, [outcome.entry.id], "clock_out");
    revalidateTimePages();
    return ok({
      id: outcome.entry.id,
      status: outcome.entry.status,
      autoClosed: outcome.capped,
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function _startBreak(employeeId: string): Promise<PunchResult> {
  try {
    const outcome = await withEmployeeLock(employeeId, async (tx) => {
      const entry = await tx.timeEntry.findFirst({
        where: { employeeId, status: { in: ["ACTIVE", "ON_BREAK"] } },
        orderBy: { clockIn: "desc" },
      });
      if (!entry || entry.status !== "ACTIVE") return { kind: "notActive" as const };
      if (isStaleShift(entry.clockIn)) return { kind: "stale" as const };
      const now = new Date();
      await tx.timeBreak.create({
        data: { timeEntryId: entry.id, startTime: now, type: "BREAK" },
      });
      const updated = await tx.timeEntry.update({
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
    revalidateTimePages();
    return ok({ id: outcome.updated.id, status: outcome.updated.status });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function _endBreak(employeeId: string): Promise<PunchResult> {
  try {
    const outcome = await withEmployeeLock(employeeId, async (tx) => {
      const entry = await tx.timeEntry.findFirst({
        where: { employeeId, status: "ON_BREAK" },
        orderBy: { clockIn: "desc" },
        include: { breaks: { where: { endTime: null } } },
      });
      if (!entry) return { kind: "notOnBreak" as const };
      if (isStaleShift(entry.clockIn)) return { kind: "stale" as const };
      const open = entry.breaks[0];
      if (!open) return { kind: "noBreak" as const };
      const now = new Date();
      const dur = Math.max(0, Math.floor((now.getTime() - open.startTime.getTime()) / 60_000));
      await tx.timeBreak.update({
        where: { id: open.id },
        data: { endTime: now, durationMin: dur },
      });
      const updated = await tx.timeEntry.update({
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
    revalidateTimePages();
    return ok({ id: outcome.updated.id, status: outcome.updated.status });
  } catch (err) {
    return failFromUnknown(err);
  }
}
