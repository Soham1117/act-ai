"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { differenceInBusinessDays, differenceInCalendarDays } from "date-fns";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";

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

export async function submitLeaveRequest(input: z.infer<typeof submitSchema>) {
  const user = await requireUser();
  if (!user.employeeId) throw new Error("No employee record");
  const data = submitSchema.parse(input);

  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  if (start > end) throw new Error("Start date must be before end date");

  const totalDays = data.totalDaysOverride ?? Math.max(1, differenceInBusinessDays(end, start) + 1);
  const noticeDays = Math.max(0, differenceInCalendarDays(start, new Date()));

  const employee = await db.employee.findUnique({ where: { id: user.employeeId } });
  if (!employee) throw new Error("Employee not found");
  if (totalDays > employee.leavesRemaining) {
    throw new Error(
      `Insufficient balance: ${employee.leavesRemaining} day(s) remaining, requested ${totalDays}.`,
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
  return created;
}

const reviewSchema = z.object({
  requestId: z.string(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().optional(),
});

export async function reviewLeave(input: z.infer<typeof reviewSchema>) {
  const admin = await requireAdmin();
  if (!admin.employeeId) throw new Error("Admin must have an employee record");
  const data = reviewSchema.parse(input);

  return db.$transaction(async (tx) => {
    const lr = await tx.leaveRequest.findUnique({ where: { id: data.requestId } });
    if (!lr) throw new Error("Not found");
    if (lr.status !== "PENDING") throw new Error("Already reviewed");

    const updated = await tx.leaveRequest.update({
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

    revalidatePath("/admin/leave");
    revalidatePath("/dashboard/leave");
    return updated;
  }).then(async (r) => {
    await audit({
      action: data.decision === "APPROVED" ? "leave.approve" : "leave.reject",
      resource: `LeaveRequest:${data.requestId}`,
      diff: { decision: data.decision, notes: data.notes },
    });
    return r;
  });
}

export async function cancelLeaveRequest(id: string) {
  const user = await requireUser();
  const lr = await db.leaveRequest.findUnique({ where: { id } });
  if (!lr) throw new Error("Not found");
  if (lr.employeeId !== user.employeeId) throw new Error("Forbidden");
  if (lr.status === "CANCELLED" || lr.status === "REJECTED")
    throw new Error("Already finalized");

  const wasApproved = lr.status === "APPROVED";
  const isFuture = lr.startDate > new Date();
  if (wasApproved && !isFuture) throw new Error("Past approved leave cannot be cancelled");

  return db.$transaction(async (tx) => {
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
    revalidatePath("/dashboard/leave");
    revalidatePath("/admin/leave");
  });
}
