"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const timeRe = /^\d{2}:\d{2}$/;

const scheduleSchema = z.object({
  employeeId: z.string(),
  date: z.string().regex(dateRe),
  jobCode: z.string(),
  startTime: z.string().regex(timeRe),
  endTime: z.string().regex(timeRe),
  notes: z.string().optional(),
});

function overlaps(
  a: { startTime: string; endTime: string },
  b: { startTime: string; endTime: string },
) {
  return !(a.endTime <= b.startTime || a.startTime >= b.endTime);
}

export async function createSchedule(
  input: z.infer<typeof scheduleSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = scheduleSchema.parse(input);
    if (data.endTime <= data.startTime) {
      return fail("End time must be after start time. Adjust the times and try again.");
    }

    const conflicts = await db.schedule.findMany({
      where: { employeeId: data.employeeId, date: new Date(data.date) },
    });
    if (conflicts.some((s) => overlaps(data, s))) {
      return fail(
        "This shift overlaps an existing shift on that date. Pick a different time window or edit the other shift first.",
      );
    }

    const created = await db.schedule.create({
      data: {
        employeeId: data.employeeId,
        date: new Date(data.date),
        jobCode: data.jobCode,
        startTime: data.startTime,
        endTime: data.endTime,
        notes: data.notes ?? null,
        createdById: admin.id,
      },
    });
    revalidatePath("/admin/schedules");
    revalidatePath("/dashboard/schedule");
    return ok({ id: created.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const updateSchema = z.object({
  id: z.string(),
  date: z.string().regex(dateRe).optional(),
  jobCode: z.string().optional(),
  startTime: z.string().regex(timeRe).optional(),
  endTime: z.string().regex(timeRe).optional(),
  notes: z.string().optional().nullable(),
});

export async function updateSchedule(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = updateSchema.parse(input);
    const existing = await db.schedule.findUnique({ where: { id: data.id } });
    if (!existing) {
      return fail("That shift no longer exists. Refresh the page and try again.");
    }

    const next = {
      date: data.date ? new Date(data.date) : existing.date,
      startTime: data.startTime ?? existing.startTime,
      endTime: data.endTime ?? existing.endTime,
    };
    if (next.endTime <= next.startTime) {
      return fail("End time must be after start time. Adjust the times and try again.");
    }

    const sameDay = await db.schedule.findMany({
      where: {
        employeeId: existing.employeeId,
        date: next.date,
        NOT: { id: data.id },
      },
    });
    if (sameDay.some((s) => overlaps(next, s))) {
      return fail(
        "This shift overlaps an existing shift on that date. Pick a different time window or edit the other shift first.",
      );
    }

    const updated = await db.schedule.update({
      where: { id: data.id },
      data: {
        date: next.date,
        startTime: next.startTime,
        endTime: next.endTime,
        jobCode: data.jobCode ?? existing.jobCode,
        notes: data.notes === undefined ? existing.notes : data.notes,
      },
    });
    revalidatePath("/admin/schedules");
    revalidatePath("/dashboard/schedule");
    return ok({ id: updated.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function deleteSchedule(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await db.schedule.delete({ where: { id } });
    revalidatePath("/admin/schedules");
    revalidatePath("/dashboard/schedule");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

const bulkSchema = z.object({
  employeeIds: z.array(z.string()).min(1),
  dates: z.array(z.string().regex(dateRe)).min(1),
  jobCode: z.string(),
  startTime: z.string().regex(timeRe),
  endTime: z.string().regex(timeRe),
  notes: z.string().optional(),
});

/**
 * Bulk create the cartesian product of {employees × dates}. Conflicts are
 * skipped silently; the response reports created vs skipped counts so the
 * UI can show a useful summary.
 */
export async function createSchedulesBulk(
  input: z.infer<typeof bulkSchema>,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const admin = await requireAdmin();
  try {
    const data = bulkSchema.parse(input);
    if (data.endTime <= data.startTime) {
      return fail("End time must be after start time. Adjust the times and try again.");
    }

    let created = 0;
    let skipped = 0;
    for (const employeeId of data.employeeIds) {
      for (const dateStr of data.dates) {
        const conflicts = await db.schedule.findMany({
          where: { employeeId, date: new Date(dateStr) },
        });
        if (conflicts.some((s) => overlaps(data, s))) {
          skipped++;
          continue;
        }
        await db.schedule.create({
          data: {
            employeeId,
            date: new Date(dateStr),
            jobCode: data.jobCode,
            startTime: data.startTime,
            endTime: data.endTime,
            notes: data.notes ?? null,
            createdById: admin.id,
          },
        });
        created++;
      }
    }
    revalidatePath("/admin/schedules");
    revalidatePath("/dashboard/schedule");
    return ok({ created, skipped });
  } catch (err) {
    return failFromUnknown(err);
  }
}
