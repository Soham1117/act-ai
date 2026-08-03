"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import type { TimeEntryStatus } from "@prisma/client";

/** Pick the best job code for an employee using the legacy 5-tier resolver. */
async function resolveJobCode(employeeId: string): Promise<string> {
  const primaryAssignment = await db.jobCodeAssignment.findFirst({
    where: { employeeId, isPrimary: true, jobCode: { isActive: true } },
    include: { jobCode: true },
  });
  if (primaryAssignment) return primaryAssignment.jobCode.code;

  const anyAssignment = await db.jobCodeAssignment.findFirst({
    where: { employeeId, jobCode: { isActive: true } },
    include: { jobCode: true },
  });
  if (anyAssignment) return anyAssignment.jobCode.code;

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { primaryJobCode: true },
  });
  if (employee?.primaryJobCode?.isActive) return employee.primaryJobCode.code;

  const def = await db.jobCode.findFirst({ where: { isDefault: true, isActive: true } });
  if (def) return def.code;

  return "ACT001";
}

// Web clock-in/out has been removed: employees clock in/out via deployed
// kiosks only. The internal `_clockIn`/`_clockOut`/`_startBreak`/`_endBreak`
// helpers below remain for the kiosk action handler in `kiosk.ts`.

// Internal — used by kiosk endpoints.
export async function _clockIn(
  employeeId: string,
  jobCode?: string,
  source: "WEB" | "KIOSK" = "WEB",
  kiosk?: { kioskSlug?: string | null; kioskLabel?: string | null },
) {
  const existing = await db.timeEntry.findFirst({
    where: { employeeId, status: { in: ["ACTIVE", "ON_BREAK"] } },
  });
  if (existing) throw new Error("Already clocked in");
  const code = jobCode ?? (await resolveJobCode(employeeId));
  const entry = await db.timeEntry.create({
    data: {
      employeeId,
      date: new Date(),
      clockIn: new Date(),
      jobCode: code,
      status: "ACTIVE" as TimeEntryStatus,
      source,
      kioskSlug: kiosk?.kioskSlug ?? null,
      kioskLabel: kiosk?.kioskLabel ?? null,
    },
  });
  revalidatePath("/dashboard/time-tracking");
  revalidatePath("/admin/time-tracking");
  return entry;
}

export async function _clockOut(
  employeeId: string,
  notes?: string,
  kiosk?: { kioskSlug?: string | null; kioskLabel?: string | null },
) {
  const entry = await db.timeEntry.findFirst({
    where: { employeeId, status: { in: ["ACTIVE", "ON_BREAK"] } },
    include: { breaks: true },
  });
  if (!entry) throw new Error("No active session");

  const now = new Date();
  // Close any open break
  let totalBreakMin = entry.totalBreakMin;
  for (const b of entry.breaks) {
    if (!b.endTime) {
      const dur = Math.floor((now.getTime() - b.startTime.getTime()) / 60_000);
      await db.timeBreak.update({
        where: { id: b.id },
        data: { endTime: now, durationMin: dur },
      });
      totalBreakMin += dur;
    }
  }
  const totalMs = now.getTime() - entry.clockIn.getTime();
  const totalWorkMin = Math.max(0, Math.floor(totalMs / 60_000) - totalBreakMin);

  const updated = await db.timeEntry.update({
    where: { id: entry.id },
    data: {
      clockOut: now,
      status: "COMPLETED" as TimeEntryStatus,
      approvalStatus: "PENDING",
      totalBreakMin,
      totalWorkMin,
      timesheetNotes: notes ?? entry.timesheetNotes,
      // If a kiosk closes the entry, record which one. Don't overwrite an
      // existing kioskSlug if absent here.
      kioskSlug: kiosk?.kioskSlug ?? entry.kioskSlug,
      kioskLabel: kiosk?.kioskLabel ?? entry.kioskLabel,
    },
  });
  revalidatePath("/dashboard/time-tracking");
  revalidatePath("/admin/time-tracking");
  return updated;
}

export async function _startBreak(employeeId: string) {
  const entry = await db.timeEntry.findFirst({
    where: { employeeId, status: "ACTIVE" },
  });
  if (!entry) throw new Error("Not currently clocked in");

  const updated = await db.$transaction(async (tx) => {
    await tx.timeBreak.create({
      data: { timeEntryId: entry.id, startTime: new Date(), type: "BREAK" },
    });
    return tx.timeEntry.update({
      where: { id: entry.id },
      data: { status: "ON_BREAK" as TimeEntryStatus },
    });
  });
  revalidatePath("/dashboard/time-tracking");
  revalidatePath("/admin/time-tracking");
  return updated;
}

export async function _endBreak(employeeId: string) {
  const entry = await db.timeEntry.findFirst({
    where: { employeeId, status: "ON_BREAK" },
    include: { breaks: { where: { endTime: null } } },
  });
  if (!entry) throw new Error("Not on break");

  const open = entry.breaks[0];
  if (!open) throw new Error("No open break");
  const now = new Date();
  const dur = Math.floor((now.getTime() - open.startTime.getTime()) / 60_000);

  const updated = await db.$transaction(async (tx) => {
    await tx.timeBreak.update({
      where: { id: open.id },
      data: { endTime: now, durationMin: dur },
    });
    return tx.timeEntry.update({
      where: { id: entry.id },
      data: {
        status: "ACTIVE" as TimeEntryStatus,
        totalBreakMin: { increment: dur },
      },
    });
  });
  revalidatePath("/dashboard/time-tracking");
  revalidatePath("/admin/time-tracking");
  return updated;
}

const approveSchema = z.object({
  timeEntryId: z.string(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().optional(),
});

export async function reviewTimeEntry(input: z.infer<typeof approveSchema>) {
  const admin = await requireAdmin();
  const data = approveSchema.parse(input);
  if (!admin.employeeId) throw new Error("Admin must have an employee record to approve.");
  const updated = await db.timeEntry.update({
    where: { id: data.timeEntryId },
    data: {
      approvalStatus: data.decision,
      status: data.decision === "APPROVED" ? "APPROVED" : "REJECTED",
      approvedById: admin.employeeId,
      approvalDate: new Date(),
      approvalNotes: data.notes ?? null,
    },
  });
  revalidatePath("/admin/time-tracking");
  // Plain object only — raw rows carry a Decimal (`rate`) that can't cross the
  // server-action boundary to client components.
  return { id: updated.id, approvalStatus: updated.approvalStatus };
}
