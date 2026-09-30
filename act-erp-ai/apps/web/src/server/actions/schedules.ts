"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyEmployees } from "@/lib/notify";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { formatDateOnly } from "@/lib/format";
import { parseDateOnly } from "@/lib/time-rules";
import {
  dayDiff,
  formatShiftRange,
  isValidTime,
  shiftDateTimes,
  shiftEndDate,
  shiftsOverlap,
  isOvernight,
} from "@/lib/schedule-rules";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const timeRe = /^\d{2}:\d{2}$/;

const OVERLAP_MESSAGE =
  "This shift overlaps an existing shift (shifts that run past midnight count into the next day). Pick a different time window or edit the other shift first.";

const scheduleSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().regex(dateRe),
  jobCode: z.string().trim().min(1, "Enter a job code."),
  startTime: z.string().regex(timeRe),
  endTime: z.string().regex(timeRe),
  notes: z.string().max(2000).optional(),
});

type ShiftRow = { id: string; employeeId: string; date: string; startTime: string; endTime: string };

function ds(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number) {
  const d = parseDateOnly(dateStr)!;
  return new Date(d.getTime() + n * 86_400_000);
}

function checkTimes(date: string, startTime: string, endTime: string): string | null {
  if (!parseDateOnly(date)) return "That date isn't valid.";
  if (!isValidTime(startTime) || !isValidTime(endTime)) return "Enter valid start and end times.";
  if (startTime === endTime) {
    return "Start and end time can't be the same. For an overnight shift, set the end earlier than the start (for example 10:00 PM to 6:00 AM).";
  }
  return null;
}

async function checkJobCode(code: string): Promise<string | null> {
  const jc = await db.jobCode.findUnique({ where: { code } });
  if (!jc) return `Job code ${code} doesn't exist. Pick an existing job code.`;
  if (!jc.isActive) return `Job code ${code} is inactive. Pick an active job code.`;
  return null;
}

async function loadNeighbors(
  client: Pick<typeof db, "schedule">,
  employeeIds: string[],
  minDate: string,
  maxDate: string,
  excludeId?: string,
): Promise<ShiftRow[]> {
  const rows = await client.schedule.findMany({
    where: {
      employeeId: { in: employeeIds },
      date: { gte: addDays(minDate, -1), lte: addDays(maxDate, 1) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, employeeId: true, date: true, startTime: true, endTime: true },
  });
  return rows.map((r) => ({ ...r, date: ds(r.date) }));
}

/** Approved leave overlapping any of the given shifts -> human warnings (non-blocking). */
async function leaveWarnings(
  shifts: { employeeId: string; date: string; startTime: string; endTime: string }[],
): Promise<string[]> {
  if (shifts.length === 0) return [];
  const employeeIds = [...new Set(shifts.map((s) => s.employeeId))];
  const dates = shifts.map((s) => s.date).sort();
  const from = parseDateOnly(dates[0]!)!;
  const to = addDays(dates[dates.length - 1]!, 1);
  const leaves = await db.leaveRequest.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: "APPROVED",
      startDate: { lte: to },
      endDate: { gte: from },
    },
    select: {
      employeeId: true,
      leaveType: true,
      startDate: true,
      endDate: true,
      employee: { select: { name: true } },
    },
  });
  const warnings: string[] = [];
  for (const s of shifts) {
    const end = shiftEndDate(s.date, s.startTime, s.endTime);
    for (const l of leaves) {
      if (l.employeeId !== s.employeeId) continue;
      if (ds(l.startDate) <= end && ds(l.endDate) >= s.date) {
        warnings.push(
          `${l.employee.name} has approved ${String(l.leaveType).toLowerCase().replace(/_/g, " ")} leave (${formatDateOnly(l.startDate)} to ${formatDateOnly(l.endDate)}) overlapping ${formatDateOnly(parseDateOnly(s.date))}.`,
        );
        break;
      }
    }
  }
  if (warnings.length > 6) {
    const extra = warnings.length - 5;
    return [...warnings.slice(0, 5), `...and ${extra} more shifts overlap approved leave.`];
  }
  return warnings;
}

function revalidateSchedules() {
  revalidatePath("/admin/schedules");
  revalidatePath("/dashboard/schedule");
}

// ──────────────────────────────────────────────────────────────────────
// Create
// ──────────────────────────────────────────────────────────────────────

export async function createSchedule(
  input: z.infer<typeof scheduleSchema>,
): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  const admin = await requireAdmin();
  try {
    const data = scheduleSchema.parse(input);
    const jobCode = data.jobCode.toUpperCase();
    const timeErr = checkTimes(data.date, data.startTime, data.endTime);
    if (timeErr) return fail(timeErr);
    const jcErr = await checkJobCode(jobCode);
    if (jcErr) return fail(jcErr);

    const employee = await db.employee.findUnique({
      where: { id: data.employeeId },
      select: { id: true, name: true, employmentStatus: true },
    });
    if (!employee) return fail("That employee no longer exists.");
    if (employee.employmentStatus !== "ACTIVE") {
      return fail(`${employee.name} isn't an active employee, so they can't be scheduled.`);
    }

    const neighbors = await loadNeighbors(db, [employee.id], data.date, data.date);
    if (neighbors.some((n) => shiftsOverlap(data, n))) return fail(OVERLAP_MESSAGE);

    const created = await db.schedule.create({
      data: {
        employeeId: employee.id,
        date: parseDateOnly(data.date)!,
        jobCode,
        startTime: data.startTime,
        endTime: data.endTime,
        notes: data.notes?.trim() ? data.notes.trim() : null,
        createdById: admin.id,
      },
    });
    const warnings = await leaveWarnings([{ ...data, employeeId: employee.id }]);

    await audit({
      action: "schedule.create",
      resource: `Schedule:${created.id}`,
      diff: { employeeId: employee.id, date: data.date, startTime: data.startTime, endTime: data.endTime, jobCode },
    });
    await notifyEmployees([employee.id], {
      type: "SCHEDULE",
      title: "New shift scheduled",
      message: `${formatDateOnly(created.date)}, ${formatShiftRange(data.startTime, data.endTime)} (${jobCode}).`,
      link: "/dashboard/schedule",
    });
    revalidateSchedules();
    return ok({ id: created.id, warnings });
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Update
// ──────────────────────────────────────────────────────────────────────

const updateSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(dateRe).optional(),
  jobCode: z.string().trim().min(1).optional(),
  startTime: z.string().regex(timeRe).optional(),
  endTime: z.string().regex(timeRe).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function updateSchedule(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  await requireAdmin();
  try {
    const data = updateSchema.parse(input);
    const existing = await db.schedule.findUnique({
      where: { id: data.id },
      include: { employee: { select: { id: true, name: true, employmentStatus: true } } },
    });
    if (!existing) {
      return fail("That shift no longer exists. Refresh the page and try again.");
    }
    if (existing.employee.employmentStatus !== "ACTIVE") {
      return fail(
        `${existing.employee.name} isn't an active employee, so their shifts can't be edited. Delete the shift instead.`,
      );
    }

    const next = {
      date: data.date ?? ds(existing.date),
      startTime: data.startTime ?? existing.startTime,
      endTime: data.endTime ?? existing.endTime,
      jobCode: (data.jobCode ?? existing.jobCode).toUpperCase(),
    };
    const timeErr = checkTimes(next.date, next.startTime, next.endTime);
    if (timeErr) return fail(timeErr);
    if (next.jobCode !== existing.jobCode) {
      const jcErr = await checkJobCode(next.jobCode);
      if (jcErr) return fail(jcErr);
    }

    const neighbors = await loadNeighbors(db, [existing.employeeId], next.date, next.date, existing.id);
    if (neighbors.some((n) => shiftsOverlap(next, n))) return fail(OVERLAP_MESSAGE);

    const updated = await db.schedule.update({
      where: { id: data.id },
      data: {
        date: parseDateOnly(next.date)!,
        startTime: next.startTime,
        endTime: next.endTime,
        jobCode: next.jobCode,
        notes:
          data.notes === undefined ? existing.notes : data.notes?.trim() ? data.notes.trim() : null,
      },
    });
    const warnings = await leaveWarnings([{ employeeId: existing.employeeId, ...next }]);

    const changed =
      next.date !== ds(existing.date) ||
      next.startTime !== existing.startTime ||
      next.endTime !== existing.endTime ||
      next.jobCode !== existing.jobCode;
    await audit({
      action: "schedule.update",
      resource: `Schedule:${updated.id}`,
      diff: {
        employeeId: existing.employeeId,
        before: {
          date: ds(existing.date),
          startTime: existing.startTime,
          endTime: existing.endTime,
          jobCode: existing.jobCode,
        },
        after: next,
      },
    });
    if (changed) {
      await notifyEmployees([existing.employeeId], {
        type: "SCHEDULE",
        title: "Your shift was changed",
        message: `Was ${formatDateOnly(existing.date)}, ${formatShiftRange(existing.startTime, existing.endTime)}. Now ${formatDateOnly(updated.date)}, ${formatShiftRange(next.startTime, next.endTime)} (${next.jobCode}).`,
        link: "/dashboard/schedule",
      });
    }
    revalidateSchedules();
    return ok({ id: updated.id, warnings });
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Delete
// ──────────────────────────────────────────────────────────────────────

export async function deleteSchedule(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const existing = await db.schedule.findUnique({ where: { id } });
    if (!existing) return fail("That shift was already deleted. Refresh the page.");
    await db.schedule.delete({ where: { id } });
    await audit({
      action: "schedule.delete",
      resource: `Schedule:${id}`,
      diff: {
        employeeId: existing.employeeId,
        date: ds(existing.date),
        startTime: existing.startTime,
        endTime: existing.endTime,
        jobCode: existing.jobCode,
      },
    });
    await notifyEmployees([existing.employeeId], {
      type: "SCHEDULE",
      title: "A shift was cancelled",
      message: `${formatDateOnly(existing.date)}, ${formatShiftRange(existing.startTime, existing.endTime)} (${existing.jobCode}) was removed from your schedule.`,
      link: "/dashboard/schedule",
    });
    revalidateSchedules();
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Bulk
// ──────────────────────────────────────────────────────────────────────

const bulkSchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1).max(200),
  dates: z.array(z.string().regex(dateRe)).min(1).max(366),
  jobCode: z.string().trim().min(1, "Enter a job code."),
  startTime: z.string().regex(timeRe),
  endTime: z.string().regex(timeRe),
  notes: z.string().max(2000).optional(),
});

/**
 * Bulk create {employees x dates} in ONE transaction. Conflicting slots are
 * skipped (and counted); everything else is all-or-nothing.
 */
export async function createSchedulesBulk(
  input: z.infer<typeof bulkSchema>,
): Promise<ActionResult<{ created: number; skipped: number; warnings: string[] }>> {
  const admin = await requireAdmin();
  try {
    const data = bulkSchema.parse(input);
    const jobCode = data.jobCode.toUpperCase();
    const employeeIds = [...new Set(data.employeeIds)];
    const dates = [...new Set(data.dates)].sort();
    if (employeeIds.length * dates.length > 1500) {
      return fail("That's too many shifts at once (max 1500). Split it into smaller batches.");
    }
    for (const d of dates) {
      const e = checkTimes(d, data.startTime, data.endTime);
      if (e) return fail(e);
    }
    const jcErr = await checkJobCode(jobCode);
    if (jcErr) return fail(jcErr);

    const employees = await db.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, name: true, employmentStatus: true },
    });
    if (employees.length !== employeeIds.length) {
      return fail("One of the selected employees no longer exists. Refresh and try again.");
    }
    const inactive = employees.filter((e) => e.employmentStatus !== "ACTIVE");
    if (inactive.length > 0) {
      return fail(
        `Only active employees can be scheduled. Remove: ${inactive.map((e) => e.name).join(", ")}.`,
      );
    }

    const notes = data.notes?.trim() ? data.notes.trim() : null;
    const result = await db.$transaction(async (tx) => {
      const existing = await loadNeighbors(tx, employeeIds, dates[0]!, dates[dates.length - 1]!);
      const occupied = [...existing];
      const toCreate: { employeeId: string; date: string }[] = [];
      let skipped = 0;
      for (const employeeId of employeeIds) {
        for (const date of dates) {
          const cand = { date, startTime: data.startTime, endTime: data.endTime };
          if (occupied.some((o) => o.employeeId === employeeId && shiftsOverlap(cand, o))) {
            skipped++;
            continue;
          }
          occupied.push({ id: "new", employeeId, ...cand });
          toCreate.push({ employeeId, date });
        }
      }
      if (toCreate.length > 0) {
        await tx.schedule.createMany({
          data: toCreate.map((c) => ({
            employeeId: c.employeeId,
            date: parseDateOnly(c.date)!,
            jobCode,
            startTime: data.startTime,
            endTime: data.endTime,
            notes,
            createdById: admin.id,
          })),
        });
      }
      return { toCreate, skipped };
    });

    const warnings = await leaveWarnings(
      result.toCreate.map((c) => ({
        ...c,
        startTime: data.startTime,
        endTime: data.endTime,
      })),
    );

    await audit({
      action: "schedule.bulk_create",
      resource: "Schedule:bulk",
      diff: {
        employeeIds,
        dates: [dates[0], dates[dates.length - 1]],
        startTime: data.startTime,
        endTime: data.endTime,
        jobCode,
        created: result.toCreate.length,
        skipped: result.skipped,
      },
    });
    const perEmployee = new Map<string, number>();
    for (const c of result.toCreate) {
      perEmployee.set(c.employeeId, (perEmployee.get(c.employeeId) ?? 0) + 1);
    }
    for (const [employeeId, n] of perEmployee) {
      await notifyEmployees([employeeId], {
        type: "SCHEDULE",
        title: n === 1 ? "New shift scheduled" : `${n} new shifts scheduled`,
        message:
          n === 1
            ? `${formatDateOnly(parseDateOnly(result.toCreate.find((c) => c.employeeId === employeeId)!.date))}, ${formatShiftRange(data.startTime, data.endTime)} (${jobCode}).`
            : `${n} shifts, ${formatShiftRange(data.startTime, data.endTime)} (${jobCode}), between ${formatDateOnly(parseDateOnly(dates[0]!))} and ${formatDateOnly(parseDateOnly(dates[dates.length - 1]!))}.`,
        link: "/dashboard/schedule",
      });
    }
    revalidateSchedules();
    return ok({ created: result.toCreate.length, skipped: result.skipped, warnings });
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Reads for month navigation (past and future months)
// ──────────────────────────────────────────────────────────────────────

const rangeSchema = z.object({ start: z.string().regex(dateRe), end: z.string().regex(dateRe) });

export type ScheduleEvent = {
  id: string;
  title: string;
  start: string; // "YYYY-MM-DD HH:mm"
  end: string;
  description: string;
  employeeId: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string | null;
  jobCode: string;
  notes: string | null;
  date: string;
  startTime: string;
  endTime: string;
  overnight: boolean;
};

function rangeBounds(input: z.infer<typeof rangeSchema>) {
  const data = rangeSchema.parse(input);
  const start = parseDateOnly(data.start);
  const end = parseDateOnly(data.end);
  if (!start || !end || end < start) return null;
  if (dayDiff(data.start, data.end) > 100) return null;
  // One extra day back so an overnight shift that began before the range still shows.
  return { gte: new Date(start.getTime() - 86_400_000), lte: end };
}

/** Admin: all shifts overlapping a date range. */
export async function getScheduleEvents(
  input: z.infer<typeof rangeSchema>,
): Promise<ActionResult<{ events: ScheduleEvent[] }>> {
  await requireAdmin();
  try {
    const bounds = rangeBounds(input);
    if (!bounds) return fail("That date range isn't valid.");
    const rows = await db.schedule.findMany({
      where: { date: bounds },
      include: {
        employee: {
          select: { name: true, department: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: 5000,
    });
    return ok({
      events: rows.map((s) => {
        const date = ds(s.date);
        const over = isOvernight(s.startTime, s.endTime);
        const { start, end } = shiftDateTimes(date, s.startTime, s.endTime);
        return {
          id: s.id,
          title: `${s.employee.name} · ${s.jobCode}${over ? " (+1 day)" : ""}`,
          start,
          end,
          description: s.notes ?? "",
          employeeId: s.employeeId,
          employeeName: s.employee.name,
          departmentId: s.employee.department?.id ?? null,
          departmentName: s.employee.department?.name ?? null,
          jobCode: s.jobCode,
          notes: s.notes,
          date,
          startTime: s.startTime,
          endTime: s.endTime,
          overnight: over,
        };
      }),
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Employee: my own shifts overlapping a date range (read-only). */
export async function getMyScheduleEvents(
  input: z.infer<typeof rangeSchema>,
): Promise<
  ActionResult<{
    events: { id: string; title: string; start: string; end: string; description: string }[];
  }>
> {
  const user = await requireUser();
  try {
    if (!user.employeeId) return ok({ events: [] });
    const bounds = rangeBounds(input);
    if (!bounds) return fail("That date range isn't valid.");
    const rows = await db.schedule.findMany({
      where: { employeeId: user.employeeId, date: bounds },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });
    return ok({
      events: rows.map((s) => {
        const { start, end } = shiftDateTimes(ds(s.date), s.startTime, s.endTime);
        return {
          id: s.id,
          title: `${s.jobCode}${isOvernight(s.startTime, s.endTime) ? " (+1 day)" : ""}`,
          start,
          end,
          description: s.notes ?? "",
        };
      }),
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}
