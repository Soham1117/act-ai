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
import { effectivePeriodStatus } from "@/lib/payroll-period";
import { closedPeriodMessage } from "@/server/payroll-close";
import { resolveHourlyRate } from "@/lib/time-rate";

const schema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1).max(200),
  /** YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** HH:mm local Central */
  clockInTime: z.string().regex(/^\d{2}:\d{2}$/),
  clockOutTime: z.string().regex(/^\d{2}:\d{2}$/),
  jobCode: z.string().trim().min(1).max(40),
  /** Unpaid break in minutes, taken as one break at the middle of the shift. */
  breakMin: z.number().int().min(0).max(240).default(0),
  reason: z.string().trim().min(3).max(500),
  approve: z.boolean().optional(),
});

function localStamp(date: string, hm: string): Date {
  const parsed = businessLocalToDate(`${date}T${hm}`);
  if (!parsed) throw new Error(`Invalid local time ${date} ${hm}`);
  return parsed;
}


/** One break centred in the shift; null when no break is requested. */
function middleBreak(clockIn: Date, clockOut: Date, breakMin: number) {
  if (breakMin <= 0) return null;
  const mid = (clockIn.getTime() + clockOut.getTime()) / 2;
  return {
    startTime: new Date(mid - (breakMin * 60_000) / 2),
    endTime: new Date(mid + (breakMin * 60_000) / 2),
  };
}

function plan(data: z.infer<typeof schema>) {
  const clockIn = localStamp(data.date, data.clockInTime);
  const clockOut = localStamp(data.date, data.clockOutTime);
  const brk = middleBreak(clockIn, clockOut, data.breakMin);
  const breaks = brk ? [{ id: undefined, ...brk }] : [];
  const timeErr = validateEntryTimes({ clockIn, clockOut, breaks });
  const totals = timeErr ? null : computeEntryTotals({ clockIn, clockOut, breaks });
  return { clockIn, clockOut, brk, timeErr, totals };
}

export async function previewMassHours(
  input: z.infer<typeof schema>,
): Promise<
  ActionResult<{
    rows: Array<{
      employeeId: string;
      name: string;
      overlap: boolean;
      inactive: boolean;
      workMin: number;
    }>;
    /** The date falls in a pay period whose last day has passed. */
    periodEnded: boolean;
  }>
> {
  await requireAdmin();
  try {
    const data = schema.parse(input);
    const { clockIn, clockOut, timeErr, totals } = plan(data);
    if (timeErr || !totals) return fail(timeErr ?? "Invalid shift.");

    const employees = await db.employee.findMany({
      where: { id: { in: data.employeeIds } },
      select: { id: true, name: true, employmentStatus: true },
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
    const day = businessDateOnly(clockIn);
    const periods = await db.payrollCalendar.findMany({
      where: { payPeriodStart: { lte: day }, payPeriodEnd: { gte: day } },
    });
    const periodEnded = periods.some(
      (p) => effectivePeriodStatus(p.status, p.payPeriodStart, p.payPeriodEnd) === "COMPLETED",
    );

    return ok({
      rows: data.employeeIds.map((id) => ({
        employeeId: id,
        name: byId.get(id)?.name ?? id,
        overlap: overlapSet.has(id),
        inactive: byId.get(id)?.employmentStatus !== "ACTIVE",
        workMin: totals.totalWorkMin,
      })),
      periodEnded,
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function commitMassHours(
  input: z.infer<typeof schema>,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const admin = await requireAdmin();
  let created = 0;
  let skipped = 0;
  let data: z.infer<typeof schema> | null = null;
  try {
    data = schema.parse(input);
    const req = data;
    if (req.approve && !admin.employeeId) {
      return fail(
        "Your admin account has no employee profile linked, so it can't approve entries.",
      );
    }
    const { clockIn, clockOut, brk, timeErr, totals } = plan(req);
    if (timeErr || !totals) return fail(timeErr ?? "Invalid shift.");
    const now = new Date();

    const closedMsg = await closedPeriodMessage(businessDateOnly(clockIn));
    if (closedMsg) return fail(closedMsg);

    const jc = await db.jobCode.findFirst({
      where: { code: req.jobCode, isActive: true },
      select: { code: true },
    });
    if (!jc) return fail("That job code is not active.");

    // Refuse the whole batch up front rather than failing halfway through it.
    const people = await db.employee.findMany({
      where: { id: { in: req.employeeIds } },
      select: { id: true, name: true, employmentStatus: true },
    });
    const known = new Map(people.map((p) => [p.id, p]));
    const unknown = req.employeeIds.filter((id) => !known.has(id));
    if (unknown.length) {
      return fail(`${unknown.length} selected people no longer exist. Start again.`);
    }
    const notActive = people.filter((p) => p.employmentStatus !== "ACTIVE");
    if (notActive.length) {
      const names = notActive.slice(0, 5).map((p) => p.name).join(", ");
      return fail(`Not active: ${names}${notActive.length > 5 ? "…" : ""}. Remove them and try again.`);
    }

    for (const employeeId of req.employeeIds) {
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

        const rate = await resolveHourlyRate(tx, employeeId, req.jobCode);
        const entry = await tx.timeEntry.create({
          data: {
            employeeId,
            date: businessDateOnly(clockIn),
            clockIn,
            clockOut,
            jobCode: req.jobCode,
            rate,
            source: "MANUAL",
            status: req.approve ? "APPROVED" : "COMPLETED",
            approvalStatus: req.approve ? "APPROVED" : "PENDING",
            approvedById: req.approve ? admin.employeeId : null,
            approvalDate: req.approve ? now : null,
            approvalNotes: req.approve ? "Approved via mass hours." : null,
            totalBreakMin: totals.totalBreakMin,
            totalWorkMin: totals.totalWorkMin,
            lastEditedById: admin.id,
            editReason: `Mass hours: ${req.reason}`,
            ...(brk
              ? {
                  breaks: {
                    create: {
                      startTime: brk.startTime,
                      endTime: brk.endTime,
                      durationMin: totals.totalBreakMin,
                      type: "BREAK" as const,
                    },
                  },
                }
              : {}),
          },
          select: { id: true },
        });
        return { skipped: false as const, id: entry.id };
      });
      if (result.skipped) {
        skipped += 1;
      } else {
        created += 1;
        await audit({
          action: "time.mass_create_entry",
          resource: `TimeEntry:${result.id}`,
          diff: { employeeId, date: req.date, jobCode: req.jobCode, reason: req.reason },
        });
      }
    }

    await audit({
      action: "time.mass_create",
      resource: `MassHours:${req.date}`,
      diff: {
        employeeCount: req.employeeIds.length,
        created,
        skipped,
        jobCode: req.jobCode,
        breakMin: req.breakMin,
        reason: req.reason,
        approve: !!req.approve,
        tz: BUSINESS_TZ,
      },
    });
    revalidateTimePages();
    return ok({ created, skipped });
  } catch (err) {
    // Entries are saved one person at a time, so a failure part-way leaves the
    // earlier ones in place. Say so and record it.
    if (created > 0 && data) {
      await audit({
        action: "time.mass_create",
        resource: `MassHours:${data.date}`,
        diff: {
          partial: true,
          created,
          skipped,
          requested: data.employeeIds.length,
          reason: data.reason,
        },
      }).catch(() => undefined);
      revalidateTimePages();
      return fail(
        `Stopped after saving ${created} of ${data.employeeIds.length} entries. Those are saved; check Individual hours before running it again.`,
      );
    }
    return failFromUnknown(err);
  }
}
