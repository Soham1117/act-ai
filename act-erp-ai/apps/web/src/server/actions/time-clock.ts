"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyEmployees } from "@/lib/notify";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { formatDateOnly, formatHours } from "@/lib/format";
import { revalidateTimePages, withEmployeeLock } from "@/server/time-core";

// NOTE: the punch helpers (_clockIn/_clockOut/_startBreak/_endBreak) live in
// `@/server/time-core` — they must not be exported from a "use server" file
// because they take a bare employeeId without authentication. Clock in/out is
// kiosk-only; the kiosk actions authenticate via kiosk session + PIN.

const NO_EMPLOYEE_LINK =
  "Your admin account has no employee profile linked. Ask another admin to link one before you can approve time entries.";

const reviewSchema = z.object({
  timeEntryId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().trim().max(1000).optional(),
  /** Explicitly re-decide an entry that was already approved or rejected. */
  allowReReview: z.boolean().optional(),
});

function reviewMessage(
  decision: "APPROVED" | "REJECTED",
  date: Date,
  totalWorkMin: number,
  notes: string | null | undefined,
) {
  const base = `Your timesheet for ${formatDateOnly(date)} (${formatHours(totalWorkMin)}) was ${
    decision === "APPROVED" ? "approved" : "rejected"
  }.`;
  return notes ? `${base} ${decision === "REJECTED" ? "Reason" : "Note"}: ${notes}` : base;
}

export async function reviewTimeEntry(
  input: z.infer<typeof reviewSchema>,
): Promise<ActionResult<{ id: string; approvalStatus: string }>> {
  const admin = await requireAdmin();
  if (!admin.employeeId) return fail(NO_EMPLOYEE_LINK);
  try {
    const data = reviewSchema.parse(input);
    const notes = data.notes?.trim() || null;
    if (data.decision === "REJECTED" && !notes) {
      return fail("Enter a reason for rejecting this entry. The employee will see it.");
    }

    const existing = await db.timeEntry.findUnique({
      where: { id: data.timeEntryId },
      select: { employeeId: true },
    });
    if (!existing) return fail("That time entry no longer exists. Refresh the page.");

    const result = await withEmployeeLock(existing.employeeId, async (tx) => {
      const entry = await tx.timeEntry.findUnique({ where: { id: data.timeEntryId } });
      if (!entry) return { error: "That time entry no longer exists. Refresh the page." };
      if (!entry.clockOut || entry.status === "ACTIVE" || entry.status === "ON_BREAK") {
        return { error: "This entry is still open. Force clock-out or edit it before reviewing." };
      }
      const pending = entry.approvalStatus === "PENDING";
      if (!pending && !data.allowReReview) {
        return {
          error: `This entry was already ${entry.approvalStatus.toLowerCase()}. Refresh the page.`,
        };
      }
      const updated = await tx.timeEntry.update({
        where: { id: entry.id },
        data: {
          approvalStatus: data.decision,
          status: data.decision,
          approvedById: admin.employeeId,
          approvalDate: new Date(),
          approvalNotes: notes,
        },
      });
      return { entry, updated };
    });
    if ("error" in result) return fail(result.error!);

    const { entry, updated } = result;
    await audit({
      action: `time.${data.decision === "APPROVED" ? "approve" : "reject"}`,
      resource: `TimeEntry:${entry.id}`,
      diff: {
        employeeId: entry.employeeId,
        before: { approvalStatus: entry.approvalStatus, status: entry.status },
        after: { approvalStatus: updated.approvalStatus, status: updated.status },
        notes,
        reReview: entry.approvalStatus !== "PENDING",
      },
    });
    await notifyEmployees([entry.employeeId], {
      type: "TIME",
      title: data.decision === "APPROVED" ? "Timesheet approved" : "Timesheet rejected",
      message: reviewMessage(data.decision, entry.date, updated.totalWorkMin, notes),
      link: "/dashboard/time-tracking",
      priority: data.decision === "REJECTED" ? "HIGH" : "MEDIUM",
    });
    revalidateTimePages();
    return ok({ id: updated.id, approvalStatus: updated.approvalStatus });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one entry.").max(500),
  decision: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * Approve (or reject, with a shared reason) many pending entries at once.
 * Only COMPLETED + PENDING entries are touched; anything else is skipped and
 * reported back.
 */
export async function bulkReviewTimeEntries(
  input: z.infer<typeof bulkSchema>,
): Promise<ActionResult<{ updated: number; skipped: number }>> {
  const admin = await requireAdmin();
  if (!admin.employeeId) return fail(NO_EMPLOYEE_LINK);
  try {
    const data = bulkSchema.parse(input);
    const notes = data.notes?.trim() || null;
    if (data.decision === "REJECTED" && !notes) {
      return fail("Enter a reason for rejecting these entries. Employees will see it.");
    }
    const ids = [...new Set(data.ids)];

    const eligible = await db.timeEntry.findMany({
      where: {
        id: { in: ids },
        approvalStatus: "PENDING",
        status: "COMPLETED",
        clockOut: { not: null },
      },
      select: { id: true, employeeId: true, date: true, totalWorkMin: true },
    });
    if (eligible.length === 0) {
      return fail("None of the selected entries are pending review any more. Refresh the page.");
    }

    const now = new Date();
    const count = await db.$transaction(async (tx) => {
      const res = await tx.timeEntry.updateMany({
        where: {
          id: { in: eligible.map((e) => e.id) },
          approvalStatus: "PENDING",
          status: "COMPLETED",
        },
        data: {
          approvalStatus: data.decision,
          status: data.decision,
          approvedById: admin.employeeId,
          approvalDate: now,
          approvalNotes: notes,
        },
      });
      return res.count;
    });

    await audit({
      action: `time.bulk_${data.decision === "APPROVED" ? "approve" : "reject"}`,
      resource: "TimeEntry:bulk",
      diff: { ids: eligible.map((e) => e.id), requested: ids.length, updated: count, notes },
    });

    const byEmployee = new Map<string, number>();
    for (const e of eligible) byEmployee.set(e.employeeId, (byEmployee.get(e.employeeId) ?? 0) + 1);
    for (const [employeeId, n] of byEmployee) {
      await notifyEmployees([employeeId], {
        type: "TIME",
        title: data.decision === "APPROVED" ? "Timesheets approved" : "Timesheets rejected",
        message:
          `${n} of your time ${n === 1 ? "entry was" : "entries were"} ${
            data.decision === "APPROVED" ? "approved" : "rejected"
          }.` + (notes ? ` ${data.decision === "REJECTED" ? "Reason" : "Note"}: ${notes}` : ""),
        link: "/dashboard/time-tracking",
        priority: data.decision === "REJECTED" ? "HIGH" : "MEDIUM",
      });
    }
    revalidateTimePages();
    return ok({ updated: count, skipped: ids.length - count });
  } catch (err) {
    return failFromUnknown(err);
  }
}
