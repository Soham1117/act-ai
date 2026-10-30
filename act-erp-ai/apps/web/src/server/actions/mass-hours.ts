"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { businessDateOnly } from "@/lib/format";
import {
  businessLocalToDate,
  computeEntryTotals,
  validateEntryTimes,
  BUSINESS_TZ,
} from "@/lib/time-rules";
import { revalidateTimePages, withEmployeeLock } from "@/server/time-core";
import { resolveHourlyRate } from "@/lib/time-rate";

const schema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1).max(200),
  /** YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** HH:mm local Central */
  clockInTime: z.string().regex(/^\d{2}:\d{2}$/),
  clockOutTime: z.string().regex(/^\d{2}:\d{2}$/),
  jobCode: z.string().trim().min(1).max(40),
  reason: z.string().trim().min(3).max(500),
  approve: z.boolean().optional(),
});

function localStamp(date: string, hm: string): Date {
  const parsed = businessLocalToDate(`${date}T${hm}`);
  if (!parsed) throw new Error(`Invalid local time ${date} ${hm}`);
  return parsed;
}

export async function previewMassHours(
  input: z.infer<typeof schema>,
): Promise<
  ActionResult<{
    rows: Array<{
      employeeId: string;
      name: string;
      overlap: boolean;
      workMin: number;
    }>;
  }>
> {
  await requireAdmin();
  try {
    const data = schema.parse(input);
    const clockIn = localStamp(data.date, data.clockInTime);
    const clockOut = localStamp(data.date, data.clockOutTime);
    const timeErr = validateEntryTimes({ clockIn, clockOut, breaks: [] });
    if (timeErr) return fail(timeErr);
    const totals = computeEntryTotals({ clockIn, clockOut, breaks: [] });

    const employees = await db.employee.findMany({
      where: { id: { in: data.employeeIds } },
      select: { id: true, name: true },
    });
    const byId = new Map(employees.map((e) => [e.id, e]));

    const overlaps = await db.timeEntry.findMany({
      where: {
        employeeId: { in: data.employeeIds },
        clockIn: { lt: clockOut },
        OR: [{ clockOut: null }, { clockOut: { gt: clockIn } }],
      },
      select: { employeeId: true },
    });
    const overlapSet = new Set(overlaps.map((o) => o.employeeId));

    return ok({
      rows: data.employeeIds.map((id) => ({
        employeeId: id,
        name: byId.get(id)?.name ?? id,
        overlap: overlapSet.has(id),
        workMin: totals.totalWorkMin,
      })),
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function commitMassHours(
  input: z.infer<typeof schema>,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const admin = await requireAdmin();
  try {
    const data = schema.parse(input);
    if (data.approve && !admin.employeeId) {
      return fail(
        "Your admin account has no employee profile linked, so it can't approve entries.",
      );
    }
    const clockIn = localStamp(data.date, data.clockInTime);
    const clockOut = localStamp(data.date, data.clockOutTime);
    const timeErr = validateEntryTimes({ clockIn, clockOut, breaks: [] });
    if (timeErr) return fail(timeErr);
    const totals = computeEntryTotals({ clockIn, clockOut, breaks: [] });
    const now = new Date();

    const jc = await db.jobCode.findFirst({
      where: { code: data.jobCode, isActive: true },
      select: { code: true },
    });
    if (!jc) return fail("That job code is not active.");

    let created = 0;
    let skipped = 0;

    for (const employeeId of data.employeeIds) {
      const result = await withEmployeeLock(employeeId, async (tx) => {
        const overlap = await tx.timeEntry.findFirst({
          where: {
            employeeId,
            clockIn: { lt: clockOut },
            OR: [{ clockOut: null }, { clockOut: { gt: clockIn } }],
          },
          select: { id: true },
        });
        if (overlap) return { skipped: true as const };

        const rate = await resolveHourlyRate(tx, employeeId, data.jobCode);
        await tx.timeEntry.create({
          data: {
            employeeId,
            date: businessDateOnly(clockIn),
            clockIn,
            clockOut,
            jobCode: data.jobCode,
            rate,
            source: "MANUAL",
            status: data.approve ? "APPROVED" : "COMPLETED",
            approvalStatus: data.approve ? "APPROVED" : "PENDING",
            approvedById: data.approve ? admin.employeeId : null,
            approvalDate: data.approve ? now : null,
            approvalNotes: data.approve ? "Approved via mass hours." : null,
            totalBreakMin: totals.totalBreakMin,
            totalWorkMin: totals.totalWorkMin,
            lastEditedById: admin.id,
            editReason: `Mass hours: ${data.reason}`,
          },
        });
        return { skipped: false as const };
      });
      if (result.skipped) skipped += 1;
      else created += 1;
    }

    await audit({
      action: "time.mass_create",
      resource: `MassHours:${data.date}`,
      diff: {
        employeeCount: data.employeeIds.length,
        created,
        skipped,
        jobCode: data.jobCode,
        reason: data.reason,
        approve: !!data.approve,
        tz: BUSINESS_TZ,
      },
    });
    revalidateTimePages();
    return ok({ created, skipped });
  } catch (err) {
    return failFromUnknown(err);
  }
}
