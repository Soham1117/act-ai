"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { differenceInBusinessDays, differenceInCalendarDays } from "date-fns";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

const submitSchema = z.object({
  leaveType: z.enum([
    "ANNUAL", "SICK", "PERSONAL", "EMERGENCY", "MATERNITY", "PATERNITY",
    "VACATION", "FAMILY", "BEREAVEMENT", "OTHER",
  ]),
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string(),
  description: z.string().max(500).optional(),
  totalDaysOverride: z.coerce.number().optional(),
});

export async function submitLeaveRequest(
  input: z.infer<typeof submitSchema>,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  if (!user.employeeId) {
    return fail(
      "Your account has no employee profile yet. Ask an admin to create one before you can submit leave.",
    );
  }
  try {
    const data = submitSchema.parse(input);

    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (start > end) {
      return fail("Start date must be on or before the end date. Adjust the dates and try again.");
    }

    const totalDays =
      data.totalDaysOverride ?? Math.max(1, differenceInBusinessDays(end, start) + 1);
    const noticeDays = Math.max(0, differenceInCalendarDays(start, new Date()));

    const employee = await db.employee.findUnique({ where: { id: user.employeeId } });
    if (!employee) {
      return fail(
        "Your employee profile could not be found. Ask an admin to check your account, then try again.",
      );
    }
    if (totalDays > employee.leavesRemaining) {
      return fail(
        `Insufficient leave balance: you have ${employee.leavesRemaining} day(s) remaining but requested ${totalDays}. Reduce the request or ask an admin about your balance.`,
      );
    }

    const created = await db.leaveRequest.create({
      data: {
        employeeId: user.employeeId,
        leaveType: data.leaveType,
        startDate: start,
        endDate: end,
        totalDays,
        noticeDays,
        description: data.description ?? null,
      },
    });
    revalidatePath("/dashboard/leave");
    revalidatePath("/admin/leave");
    return ok({ id: created.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const reviewSchema = z.object({
  requestId: z.string(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().optional(),
});

export async function reviewLeave(
  input: z.infer<typeof reviewSchema>,
): Promise<ActionResult<{ id: string; status: string }>> {
  const admin = await requireAdmin();
  if (!admin.employeeId) {
    return fail(
      "Your admin account has no employee profile linked. Ask another admin to link one before you can review leave.",
    );
  }
  try {
    const data = reviewSchema.parse(input);

    const existing = await db.leaveRequest.findUnique({ where: { id: data.requestId } });
    if (!existing) {
      return fail("That leave request no longer exists. Refresh the page and try again.");
    }
    if (existing.status !== "PENDING") {
      return fail("That leave request was already approved or rejected. Refresh the page.");
    }

    const updated = await db.$transaction(async (tx) => {
      const lr = await tx.leaveRequest.findUnique({ where: { id: data.requestId } });
      if (!lr || lr.status !== "PENDING") {
        throw new Error("That leave request was already approved or rejected. Refresh the page.");
      }

      const row = await tx.leaveRequest.update({
        where: { id: data.requestId },
        data: {
          status: data.decision,
          reviewerId: admin.employeeId,
          reviewedAt: new Date(),
          reviewNotes: data.notes ?? null,
        },
      });

      if (data.decision === "APPROVED") {
        await tx.employee.update({
          where: { id: lr.employeeId },
          data: {
            leavesApproved: { increment: 1 },
            leavesTaken: { increment: lr.totalDays },
            leavesRemaining: { decrement: lr.totalDays },
          },
        });
      } else {
        await tx.employee.update({
          where: { id: lr.employeeId },
          data: { leavesRejected: { increment: 1 } },
        });
      }

      return row;
    });

    await audit({
      action: data.decision === "APPROVED" ? "leave.approve" : "leave.reject",
      resource: `LeaveRequest:${data.requestId}`,
      diff: { decision: data.decision, notes: data.notes },
    });
    revalidatePath("/admin/leave");
    revalidatePath("/dashboard/leave");
    return ok({ id: updated.id, status: updated.status });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function cancelLeaveRequest(id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const lr = await db.leaveRequest.findUnique({ where: { id } });
    if (!lr) {
      return fail("That leave request no longer exists. Refresh the page and try again.");
    }
    if (lr.employeeId !== user.employeeId) {
      return fail("You can only cancel your own leave requests. Refresh the page.");
    }
    if (lr.status === "CANCELLED" || lr.status === "REJECTED") {
      return fail("That leave request is already cancelled or rejected. Refresh the page.");
    }

    const wasApproved = lr.status === "APPROVED";
    const isFuture = lr.startDate > new Date();
    if (wasApproved && !isFuture) {
      return fail(
        "Approved leave that has already started cannot be cancelled. Contact an admin if you need an adjustment.",
      );
    }

    await db.$transaction(async (tx) => {
      await tx.leaveRequest.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
      if (wasApproved) {
        await tx.employee.update({
          where: { id: lr.employeeId },
          data: {
            leavesApproved: { decrement: 1 },
            leavesTaken: { decrement: lr.totalDays },
            leavesRemaining: { increment: lr.totalDays },
          },
        });
      }
    });
    revalidatePath("/dashboard/leave");
    revalidatePath("/admin/leave");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
