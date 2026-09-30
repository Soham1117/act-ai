"use server";

import { z } from "zod";
import type { TimeBreak, TimeEntry } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyEmployees } from "@/lib/notify";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { businessDateOnly, formatBusinessTime, formatDateOnly } from "@/lib/format";
import {
  MAX_SHIFT_MINUTES,
  businessLocalToDate,
  computeEntryTotals,
  isStaleShift,
  breakMinutes,
  validateEntryTimes,
} from "@/lib/time-rules";
import { closeOpenEntry, revalidateTimePages, withEmployeeLock, type Tx } from "@/server/time-core";

type EntryWithBreaks = TimeEntry & { breaks: TimeBreak[] };

const reasonSchema = z
  .string()
  .trim()
  .min(3, "Enter a reason (at least 3 characters). It is recorded in the audit log and shown to the employee.")
  .max(500, "Keep the reason under 500 characters.");

const localTime = z.string().min(1, "Enter a date and time.");
const breakSchema = z.object({
  id: z.string().optional(),
  start: localTime,
  end: localTime.nullable().optional(),
});
const notesSchema = z.string().trim().max(1000, "Keep notes under 1000 characters.").nullable().optional();
const jobCodeSchema = z.string().trim().min(1, "Choose a job code.").max(40);

const OPEN: readonly string[] = ["ACTIVE", "ON_BREAK"];
const isOpen = (e: { status: string }) => OPEN.includes(e.status);

function snapshot(e: EntryWithBreaks) {
  return {
    clockIn: e.clockIn.toISOString(),
    clockOut: e.clockOut?.toISOString() ?? null,
    jobCode: e.jobCode,
    notes: e.timesheetNotes,
    status: e.status,
    approvalStatus: e.approvalStatus,
    totalBreakMin: e.totalBreakMin,
    totalWorkMin: e.totalWorkMin,
    autoClosed: e.autoClosed,
    breaks: e.breaks
      .slice()
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
      .map((b) => ({
        start: b.startTime.toISOString(),
        end: b.endTime?.toISOString() ?? null,
        durationMin: b.durationMin,
      })),
  };
}

async function findOverlap(
  tx: Tx,
  employeeId: string,
  excludeId: string | null,
  start: Date,
  end: Date | null,
) {
  return tx.timeEntry.findFirst({
    where: {
      employeeId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      status: { not: "REJECTED" },
      ...(end ? { clockIn: { lt: end } } : {}),
      OR: [{ clockOut: null }, { clockOut: { gt: start } }],
    },
    select: { clockIn: true, clockOut: true },
  });
}

function overlapMessage(o: { clockIn: Date; clockOut: Date | null }) {
  return `That time overlaps another entry (${formatDateOnly(businessDateOnly(o.clockIn))} ${formatBusinessTime(o.clockIn)} to ${o.clockOut ? formatBusinessTime(o.clockOut) : "still open"}). Adjust the times or fix the other entry first.`;
}

async function assertJobCode(code: string, unchanged?: string): Promise<string | null> {
  if (unchanged && code === unchanged) return null;
  const jc = await db.jobCode.findUnique({ where: { code } });
  if (!jc) return `Job code ${code} doesn't exist.`;
  if (!jc.isActive) return `Job code ${code} is inactive. Choose an active job code.`;
  return null;
}

function parseLocal(value: string, label: string): { date: Date } | { error: string } {
  const d = businessLocalToDate(value);
  if (!d) return { error: `${label} isn't a valid date and time.` };
  return { date: d };
}

type ParsedBreak = { id?: string; startTime: Date; endTime: Date | null };

function parseBreaks(
  input: { id?: string; start: string; end?: string | null }[],
): { breaks: ParsedBreak[] } | { error: string } {
  const out: ParsedBreak[] = [];
  for (const b of input) {
    const s = parseLocal(b.start, "Break start");
    if ("error" in s) return s;
    let endTime: Date | null = null;
    if (b.end) {
      const e = parseLocal(b.end, "Break end");
      if ("error" in e) return e;
      endTime = e.date;
    } else {
      return { error: "Every break needs an end time. Remove the break or enter when it ended." };
    }
    out.push({ id: b.id, startTime: s.date, endTime });
  }
  return { breaks: out };
}

async function notifyCorrection(employeeId: string, date: Date, headline: string, reason: string) {
  await notifyEmployees([employeeId], {
    type: "TIME",
    title: headline,
    message: `${headline} for ${formatDateOnly(date)}. Reason: ${reason}`,
    link: "/dashboard/time-tracking",
  });
}

// ──────────────────────────────────────────────────────────────────────
// Edit
// ──────────────────────────────────────────────────────────────────────

const editSchema = z.object({
  id: z.string().min(1),
  clockIn: localTime,
  /** Required for closed entries; must be empty for open ones (use force clock-out). */
  clockOut: localTime.nullable().optional(),
  jobCode: jobCodeSchema,
  notes: notesSchema,
  /** Omit for open entries. Replaces the full break list for closed entries. */
  breaks: z.array(breakSchema).max(20).optional(),
  reason: reasonSchema,
});

export async function adminUpdateTimeEntry(
  input: z.infer<typeof editSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = editSchema.parse(input);
    const ci = parseLocal(data.clockIn, "Clock-in");
    if ("error" in ci) return fail(ci.error);
    let clockOut: Date | null = null;
    if (data.clockOut) {
      const co = parseLocal(data.clockOut, "Clock-out");
      if ("error" in co) return fail(co.error);
      clockOut = co.date;
    }
    let parsedBreaks: ParsedBreak[] | undefined;
    if (data.breaks) {
      const pb = parseBreaks(data.breaks);
      if ("error" in pb) return fail(pb.error);
      parsedBreaks = pb.breaks;
    }

    const existing = await db.timeEntry.findUnique({
      where: { id: data.id },
      select: { employeeId: true, jobCode: true },
    });
    if (!existing) return fail("That time entry no longer exists. Refresh the page.");
    const jcErr = await assertJobCode(data.jobCode, existing.jobCode);
    if (jcErr) return fail(jcErr);

    const result = await withEmployeeLock(existing.employeeId, async (tx) => {
      const entry = await tx.timeEntry.findUnique({
        where: { id: data.id },
        include: { breaks: true },
      });
      if (!entry) return { error: "That time entry no longer exists. Refresh the page." };
      const open = isOpen(entry);

      if (open && clockOut) {
        return { error: "This shift is still open. Use Force clock-out to close it." };
      }
      if (open && parsedBreaks) {
        return { error: "Close the shift (force clock-out) before editing its breaks." };
      }
      if (!open && !clockOut) {
        return { error: "Enter a clock-out time, or reopen the entry instead." };
      }

      const nextBreaks: ParsedBreak[] = open
        ? entry.breaks.map((b) => ({ id: b.id, startTime: b.startTime, endTime: b.endTime }))
        : (parsedBreaks ??
          entry.breaks.map((b) => ({ id: b.id, startTime: b.startTime, endTime: b.endTime })));

      const timeErr = validateEntryTimes({
        clockIn: ci.date,
        clockOut,
        breaks: nextBreaks,
      });
      if (timeErr) return { error: timeErr };

      const overlap = await findOverlap(tx, entry.employeeId, entry.id, ci.date, clockOut);
      if (overlap) return { error: overlapMessage(overlap) };

      const before = snapshot(entry);

      if (!open) {
        const keepIds = new Set(nextBreaks.map((b) => b.id).filter(Boolean) as string[]);
        const toDelete = entry.breaks.filter((b) => !keepIds.has(b.id)).map((b) => b.id);
        if (toDelete.length) await tx.timeBreak.deleteMany({ where: { id: { in: toDelete } } });
        for (const b of nextBreaks) {
          const dur = breakMinutes(b, ci.date, clockOut!);
          if (b.id && entry.breaks.some((x) => x.id === b.id)) {
            await tx.timeBreak.update({
              where: { id: b.id },
              data: { startTime: b.startTime, endTime: b.endTime, durationMin: dur },
            });
          } else {
            await tx.timeBreak.create({
              data: {
                timeEntryId: entry.id,
                startTime: b.startTime,
                endTime: b.endTime,
                durationMin: dur,
                type: "BREAK",
              },
            });
          }
        }
      }

      const totals = clockOut
        ? computeEntryTotals({ clockIn: ci.date, clockOut, breaks: nextBreaks })
        : null;

      const updated = await tx.timeEntry.update({
        where: { id: entry.id },
        data: {
          clockIn: ci.date,
          clockOut,
          date: businessDateOnly(ci.date),
          jobCode: data.jobCode,
          timesheetNotes: data.notes?.trim() ? data.notes.trim() : null,
          ...(totals
            ? { totalBreakMin: totals.totalBreakMin, totalWorkMin: totals.totalWorkMin }
            : {}),
          autoClosed: false,
          lastEditedById: admin.id,
          editReason: data.reason,
        },
        include: { breaks: true },
      });
      return { entry, updated, before, after: snapshot(updated) };
    });
    if ("error" in result) return fail(result.error!);

    await audit({
      action: "time.edit",
      resource: `TimeEntry:${result.entry.id}`,
      diff: {
        employeeId: result.entry.employeeId,
        reason: data.reason,
        before: result.before,
        after: result.after,
        stayedApproved: result.entry.approvalStatus === "APPROVED",
      },
    });
    await notifyCorrection(
      result.entry.employeeId,
      result.updated.date,
      "An admin corrected your time entry",
      data.reason,
    );
    revalidateTimePages();
    return ok({ id: result.entry.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Manual entry
// ──────────────────────────────────────────────────────────────────────

const manualSchema = z.object({
  employeeId: z.string().min(1, "Choose an employee."),
  clockIn: localTime,
  clockOut: localTime,
  jobCode: jobCodeSchema,
  notes: notesSchema,
  breaks: z.array(breakSchema).max(20).optional(),
  reason: reasonSchema,
  /** Approve immediately instead of leaving it in the pending queue. */
  approve: z.boolean().optional(),
});

export async function adminCreateManualTimeEntry(
  input: z.infer<typeof manualSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = manualSchema.parse(input);
    if (data.approve && !admin.employeeId) {
      return fail(
        "Your admin account has no employee profile linked, so it can't approve entries. Save it as pending instead.",
      );
    }
    const ci = parseLocal(data.clockIn, "Clock-in");
    if ("error" in ci) return fail(ci.error);
    const co = parseLocal(data.clockOut, "Clock-out");
    if ("error" in co) return fail(co.error);
    const pb = parseBreaks(data.breaks ?? []);
    if ("error" in pb) return fail(pb.error);

    const employee = await db.employee.findUnique({
      where: { id: data.employeeId },
      select: { id: true, name: true },
    });
    if (!employee) return fail("That employee no longer exists.");
    const jcErr = await assertJobCode(data.jobCode);
    if (jcErr) return fail(jcErr);

    const timeErr = validateEntryTimes({
      clockIn: ci.date,
      clockOut: co.date,
      breaks: pb.breaks,
    });
    if (timeErr) return fail(timeErr);

    const totals = computeEntryTotals({
      clockIn: ci.date,
      clockOut: co.date,
      breaks: pb.breaks,
    });
    const now = new Date();

    const result = await withEmployeeLock(employee.id, async (tx) => {
      const overlap = await findOverlap(tx, employee.id, null, ci.date, co.date);
      if (overlap) return { error: overlapMessage(overlap) };
      const created = await tx.timeEntry.create({
        data: {
          employeeId: employee.id,
          date: businessDateOnly(ci.date),
          clockIn: ci.date,
          clockOut: co.date,
          jobCode: data.jobCode,
          source: "MANUAL",
          status: data.approve ? "APPROVED" : "COMPLETED",
          approvalStatus: data.approve ? "APPROVED" : "PENDING",
          approvedById: data.approve ? admin.employeeId : null,
          approvalDate: data.approve ? now : null,
          approvalNotes: data.approve ? "Approved when entered by admin." : null,
          totalBreakMin: totals.totalBreakMin,
          totalWorkMin: totals.totalWorkMin,
          timesheetNotes: data.notes?.trim() ? data.notes.trim() : null,
          lastEditedById: admin.id,
          editReason: `Manual entry: ${data.reason}`,
          breaks: {
            create: pb.breaks.map((b) => ({
              startTime: b.startTime,
              endTime: b.endTime,
              durationMin: breakMinutes(b, ci.date, co.date),
              type: "BREAK" as const,
            })),
          },
        },
        include: { breaks: true },
      });
      return { created };
    });
    if ("error" in result) return fail(result.error!);

    await audit({
      action: "time.manual_create",
      resource: `TimeEntry:${result.created.id}`,
      diff: {
        employeeId: employee.id,
        employeeName: employee.name,
        reason: data.reason,
        approved: !!data.approve,
        after: snapshot(result.created),
      },
    });
    await notifyCorrection(
      employee.id,
      result.created.date,
      "An admin added a time entry for you",
      data.reason,
    );
    revalidateTimePages();
    return ok({ id: result.created.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Force clock-out
// ──────────────────────────────────────────────────────────────────────

const forceSchema = z.object({
  id: z.string().min(1),
  clockOut: localTime,
  reason: reasonSchema,
});

export async function adminForceClockOut(
  input: z.infer<typeof forceSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = forceSchema.parse(input);
    const co = parseLocal(data.clockOut, "Clock-out");
    if ("error" in co) return fail(co.error);

    const found = await db.timeEntry.findUnique({
      where: { id: data.id },
      select: { employeeId: true },
    });
    if (!found) return fail("That time entry no longer exists. Refresh the page.");

    const result = await withEmployeeLock(found.employeeId, async (tx) => {
      const entry = await tx.timeEntry.findUnique({
        where: { id: data.id },
        include: { breaks: true },
      });
      if (!entry) return { error: "That time entry no longer exists. Refresh the page." };
      if (!isOpen(entry)) {
        return { error: "That shift was already closed. Refresh the page." };
      }
      const timeErr = validateEntryTimes({
        clockIn: entry.clockIn,
        clockOut: co.date,
        breaks: entry.breaks.map((b) => ({ startTime: b.startTime, endTime: b.endTime })),
      });
      if (timeErr) return { error: timeErr };
      const overlap = await findOverlap(tx, entry.employeeId, entry.id, entry.clockIn, co.date);
      if (overlap) return { error: overlapMessage(overlap) };

      const before = snapshot(entry);
      const closed = await closeOpenEntry(tx, entry, co.date, {
        autoClosed: false,
        lastEditedById: admin.id,
        editReason: `Forced clock-out: ${data.reason}`,
      });
      const after = await tx.timeEntry.findUniqueOrThrow({
        where: { id: entry.id },
        include: { breaks: true },
      });
      return { entry, closed: closed.entry, before, after: snapshot(after) };
    });
    if ("error" in result) return fail(result.error!);

    await audit({
      action: "time.force_clock_out",
      resource: `TimeEntry:${result.entry.id}`,
      diff: {
        employeeId: result.entry.employeeId,
        reason: data.reason,
        before: result.before,
        after: result.after,
      },
    });
    await notifyCorrection(
      result.entry.employeeId,
      result.entry.date,
      "An admin clocked you out",
      data.reason,
    );
    revalidateTimePages();
    return ok({ id: result.entry.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Delete
// ──────────────────────────────────────────────────────────────────────

const deleteSchema = z.object({ id: z.string().min(1), reason: reasonSchema });

export async function adminDeleteTimeEntry(
  input: z.infer<typeof deleteSchema>,
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const data = deleteSchema.parse(input);
    const found = await db.timeEntry.findUnique({
      where: { id: data.id },
      select: { employeeId: true },
    });
    if (!found) return fail("That time entry was already deleted. Refresh the page.");

    const result = await withEmployeeLock(found.employeeId, async (tx) => {
      const entry = await tx.timeEntry.findUnique({
        where: { id: data.id },
        include: { breaks: true },
      });
      if (!entry) return null;
      await tx.timeEntry.delete({ where: { id: entry.id } });
      return entry;
    });
    if (!result) return fail("That time entry was already deleted. Refresh the page.");

    await audit({
      action: "time.delete",
      resource: `TimeEntry:${result.id}`,
      diff: {
        employeeId: result.employeeId,
        reason: data.reason,
        before: snapshot(result),
        source: result.source,
      },
    });
    await notifyCorrection(
      result.employeeId,
      result.date,
      "An admin removed a time entry",
      data.reason,
    );
    revalidateTimePages();
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Reopen
// ──────────────────────────────────────────────────────────────────────

const reopenSchema = z.object({ id: z.string().min(1), reason: reasonSchema });

/** Turn a closed entry back into an open shift (e.g. clocked out by mistake). */
export async function adminReopenTimeEntry(
  input: z.infer<typeof reopenSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = reopenSchema.parse(input);
    const found = await db.timeEntry.findUnique({
      where: { id: data.id },
      select: { employeeId: true },
    });
    if (!found) return fail("That time entry no longer exists. Refresh the page.");

    const result = await withEmployeeLock(found.employeeId, async (tx) => {
      const entry = await tx.timeEntry.findUnique({
        where: { id: data.id },
        include: { breaks: true },
      });
      if (!entry) return { error: "That time entry no longer exists. Refresh the page." };
      if (isOpen(entry) || !entry.clockOut) {
        return { error: "That shift is already open." };
      }
      if (isStaleShift(entry.clockIn)) {
        return {
          error: `This entry started more than ${MAX_SHIFT_MINUTES / 60} hours ago, so it can't be reopened. Edit its clock-out time instead.`,
        };
      }
      const other = await tx.timeEntry.findFirst({
        where: { employeeId: entry.employeeId, status: { in: ["ACTIVE", "ON_BREAK"] } },
        select: { id: true },
      });
      if (other) {
        return { error: "This employee is currently clocked in on another entry. Close that one first." };
      }
      const before = snapshot(entry);
      const updated = await tx.timeEntry.update({
        where: { id: entry.id },
        data: {
          clockOut: null,
          status: "ACTIVE",
          approvalStatus: "PENDING",
          approvedById: null,
          approvalDate: null,
          approvalNotes: null,
          autoClosed: false,
          totalWorkMin: 0,
          lastEditedById: admin.id,
          editReason: `Reopened: ${data.reason}`,
        },
        include: { breaks: true },
      });
      return { entry, updated, before, after: snapshot(updated) };
    });
    if ("error" in result) return fail(result.error!);

    await audit({
      action: "time.reopen",
      resource: `TimeEntry:${result.entry.id}`,
      diff: {
        employeeId: result.entry.employeeId,
        reason: data.reason,
        before: result.before,
        after: result.after,
      },
    });
    await notifyCorrection(
      result.entry.employeeId,
      result.entry.date,
      "An admin reopened your time entry",
      data.reason,
    );
    revalidateTimePages();
    return ok({ id: result.entry.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

