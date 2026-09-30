"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requireUser,
  requireAdmin,
  requireWritableUser,
  ReadOnlyAccountError,
  type SessionUser,
} from "@/lib/auth";
import { audit } from "@/lib/audit";
import { READ_ONLY_MESSAGE } from "@/lib/access";
import { notifyAdmins, notifyEmployees } from "@/lib/notify";
import { businessDateOnly, formatDateOnly } from "@/lib/format";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import {
  LEAVE_TYPES,
  balanceShortfall,
  findOverlap,
  fmtDays,
  leaveDaysForRange,
  overdrawnYears,
  parseDateOnly,
} from "@/lib/leave-balance";
import { loadBalanceInput, loadPolicies } from "@/lib/leave-balance-db";

const DAY_MS = 86_400_000;
const leaveTypeEnum = z.enum(LEAVE_TYPES);

function revalidateLeave(employeeId?: string) {
  revalidatePath("/dashboard/leave");
  revalidatePath("/dashboard");
  revalidatePath("/admin/leave");
  if (employeeId) revalidatePath(`/admin/employees/${employeeId}`);
}

function isSerializationConflict(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "P2034";
}
const CONFLICT_MESSAGE =
  "Someone else changed leave data at the same moment. Refresh the page and try again.";

function yearsSpanned(start: Date, end: Date): number[] {
  const out: number[] = [];
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) out.push(y);
  return out;
}

async function writableOrFail(): Promise<{ user: SessionUser } | { error: string }> {
  try {
    return { user: await requireWritableUser() };
  } catch (err) {
    if (err instanceof ReadOnlyAccountError) return { error: READ_ONLY_MESSAGE };
    throw err;
  }
}

// ── Submit ───────────────────────────────────────────────────────────────

const submitSchema = z.object({
  leaveType: leaveTypeEnum,
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string(),
  startHalfDay: z.boolean().optional(),
  endHalfDay: z.boolean().optional(),
  description: z.string().max(500).optional(),
  /** Admin only: create the request for another employee (past dates allowed). */
  onBehalfOfEmployeeId: z.string().optional(),
});

export async function submitLeaveRequest(
  input: z.infer<typeof submitSchema>,
): Promise<ActionResult<{ id: string; totalDays: number }>> {
  const w = await writableOrFail();
  if ("error" in w) return fail(w.error);
  const user = w.user;

  try {
    const data = submitSchema.parse(input);

    const onBehalf = !!data.onBehalfOfEmployeeId && data.onBehalfOfEmployeeId !== user.employeeId;
    if (onBehalf && user.role !== "ADMIN") {
      return fail("Only admins can create leave for another employee.");
    }
    const employeeId = onBehalf ? data.onBehalfOfEmployeeId! : user.employeeId;
    if (!employeeId) {
      return fail(
        "Your account has no employee profile yet. Ask an admin to create one before you can submit leave.",
      );
    }
    const adminOverride = user.role === "ADMIN" && onBehalf;

    const start = parseDateOnly(data.startDate);
    const end = parseDateOnly(data.endDate);
    if (!start || !end) return fail("Enter valid start and end dates.");
    if (end < start) {
      return fail("The end date must be on or after the start date. Adjust the dates and try again.");
    }
    if ((end.getTime() - start.getTime()) / DAY_MS > 366) {
      return fail("Leave requests cannot span more than one year. Split it into separate requests.");
    }
    const today = businessDateOnly();
    if (start < today && !adminOverride) {
      return fail("Start date cannot be in the past. Pick today or a later date.");
    }

    const range = {
      startDate: start,
      endDate: end,
      startHalfDay: !!data.startHalfDay,
      endHalfDay: !!data.endHalfDay,
    };
    const totalDays = leaveDaysForRange(range);
    if (totalDays <= 0) {
      return fail(
        "That range has no working days (weekends are not counted). Pick at least one weekday.",
      );
    }
    const noticeDays = Math.max(0, Math.round((start.getTime() - today.getTime()) / DAY_MS));

    type TxResult = { error: string } | { id: string; name: string };
    const result: TxResult = await db.$transaction(
      async (tx): Promise<TxResult> => {
        const employee = await tx.employee.findUnique({
          where: { id: employeeId },
          select: { id: true, name: true, employmentStatus: true },
        });
        if (!employee) {
          return {
            error:
              "Your employee profile could not be found. Ask an admin to check your account, then try again.",
          };
        }
        if (employee.employmentStatus !== "ACTIVE" && employee.employmentStatus !== "ON_LEAVE") {
          return { error: "Leave can only be requested for active employees." };
        }

        const existing = await tx.leaveRequest.findMany({
          where: {
            employeeId,
            status: { in: ["PENDING", "APPROVED"] },
            startDate: { lte: end },
            endDate: { gte: start },
          },
        });
        const clash = findOverlap(range, existing);
        if (clash) {
          return {
            error: `This overlaps your ${clash.status.toLowerCase()} ${clash.leaveType.toLowerCase()} leave (${formatDateOnly(clash.startDate)} to ${formatDateOnly(clash.endDate)}). Cancel that request first or choose different dates.`,
          };
        }

        const balInput = await loadBalanceInput(employeeId, yearsSpanned(start, end), tx);
        if (balInput) {
          const short = balanceShortfall(balInput, data.leaveType, range);
          if (short) return { error: short };
        }

        const created = await tx.leaveRequest.create({
          data: {
            employeeId,
            leaveType: data.leaveType,
            startDate: start,
            endDate: end,
            startHalfDay: range.startHalfDay,
            endHalfDay: range.endHalfDay,
            totalDays,
            noticeDays,
            description: data.description?.trim() || null,
          },
        });
        return { id: created.id, name: employee.name };
      },
      { isolationLevel: "Serializable" },
    );
    if ("error" in result) return fail(result.error);

    await audit({
      action: "leave.submit",
      resource: `LeaveRequest:${result.id}`,
      diff: {
        employeeId,
        leaveType: data.leaveType,
        startDate: data.startDate,
        endDate: data.endDate,
        totalDays,
        onBehalf,
      },
    });
    await notifyAdmins({
      type: "LEAVE",
      title: "New leave request",
      message: `${result.name} requested ${fmtDays(totalDays)} of ${data.leaveType.toLowerCase()} leave (${formatDateOnly(start)} to ${formatDateOnly(end)}).`,
      link: "/admin/leave",
    });
    revalidateLeave(employeeId);
    return ok({ id: result.id, totalDays });
  } catch (err) {
    if (isSerializationConflict(err)) return fail(CONFLICT_MESSAGE);
    return failFromUnknown(err);
  }
}

// ── Review (approve / reject) ────────────────────────────────────────────

const reviewSchema = z.object({
  requestId: z.string(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().max(1000).optional(),
  /** Approve even if it overdraws the balance. Requires notes (the reason). */
  overrideBalance: z.boolean().optional(),
});

export async function reviewLeave(
  input: z.infer<typeof reviewSchema>,
): Promise<ActionResult<{ id: string; status: string }>> {
  const admin = await requireAdmin();
  try {
    const data = reviewSchema.parse(input);
    const notes = data.notes?.trim() || null;
    if (data.decision === "REJECTED" && !notes) {
      return fail("Enter a reason for rejecting this request. The employee will see it.");
    }
    if (data.decision === "APPROVED" && data.overrideBalance && !notes) {
      return fail("Enter a reason for approving beyond the employee's balance.");
    }

    type TxResult =
      | { error: string }
      | { row: { id: string; employeeId: string; status: string; totalDays: number; leaveType: string; startDate: Date; endDate: Date }; overridden: boolean };
    const result: TxResult = await db.$transaction(
      async (tx): Promise<TxResult> => {
        const lr = await tx.leaveRequest.findUnique({ where: { id: data.requestId } });
        if (!lr) return { error: "That leave request no longer exists. Refresh the page." };
        if (lr.status !== "PENDING") {
          return {
            error: `That request is already ${lr.status.toLowerCase()}. Refresh the page.`,
          };
        }

        let overridden = false;
        if (data.decision === "APPROVED") {
          const others = await tx.leaveRequest.findMany({
            where: {
              employeeId: lr.employeeId,
              id: { not: lr.id },
              status: "APPROVED",
              startDate: { lte: lr.endDate },
              endDate: { gte: lr.startDate },
            },
          });
          const clash = findOverlap(lr, others, lr.id);
          if (clash) {
            return {
              error: `This overlaps already-approved ${clash.leaveType.toLowerCase()} leave (${formatDateOnly(clash.startDate)} to ${formatDateOnly(clash.endDate)}). Reject or adjust one of them.`,
            };
          }
          const balInput = await loadBalanceInput(lr.employeeId, yearsSpanned(lr.startDate, lr.endDate), tx);
          if (balInput) {
            const over = overdrawnYears(balInput, lr.leaveType, lr);
            if (over.length > 0) {
              if (!data.overrideBalance) {
                return {
                  error: `Approving would put the employee's ${lr.leaveType.toLowerCase()} balance below zero for ${over.join(", ")}. Adjust their balance first, or approve with the override option and a reason.`,
                };
              }
              overridden = true;
            }
          }
        }

        const res = await tx.leaveRequest.updateMany({
          where: { id: lr.id, status: "PENDING" },
          data: {
            status: data.decision,
            reviewerId: admin.employeeId ?? null,
            reviewedAt: new Date(),
            reviewNotes: notes,
          },
        });
        if (res.count !== 1) return { error: "That request was just changed by someone else. Refresh the page." };
        return {
          row: {
            id: lr.id,
            employeeId: lr.employeeId,
            status: data.decision,
            totalDays: Number(lr.totalDays),
            leaveType: lr.leaveType,
            startDate: lr.startDate,
            endDate: lr.endDate,
          },
          overridden,
        };
      },
      { isolationLevel: "Serializable" },
    );
    if ("error" in result) return fail(result.error);
    const { row, overridden } = result;

    await audit({
      action: data.decision === "APPROVED" ? "leave.approve" : "leave.reject",
      resource: `LeaveRequest:${row.id}`,
      diff: { decision: data.decision, notes, overrideBalance: overridden, employeeId: row.employeeId },
    });
    await notifyEmployees([row.employeeId], {
      type: "LEAVE",
      title: `Leave request ${data.decision === "APPROVED" ? "approved" : "rejected"}`,
      message: `Your ${row.leaveType.toLowerCase()} leave (${formatDateOnly(row.startDate)} to ${formatDateOnly(row.endDate)}, ${fmtDays(row.totalDays)}) was ${data.decision.toLowerCase()}.${notes ? ` Note: ${notes}` : ""}`,
      link: "/dashboard/leave",
    });
    revalidateLeave(row.employeeId);
    return ok({ id: row.id, status: row.status });
  } catch (err) {
    if (isSerializationConflict(err)) return fail(CONFLICT_MESSAGE);
    return failFromUnknown(err);
  }
}

// ── Cancel ───────────────────────────────────────────────────────────────

/**
 * Employees: cancel own PENDING any time, own APPROVED before its start date.
 * Admins: cancel/revert any PENDING or APPROVED request (reason required when
 * reverting an APPROVED one, or any request that isn't their own).
 */
export async function cancelLeaveRequest(id: string, reason?: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const isAdmin = user.role === "ADMIN";
    const note = reason?.trim() || null;

    type TxResult =
      | { error: string }
      | { employeeId: string; wasApproved: boolean; leaveType: string; startDate: Date; endDate: Date; byAdmin: boolean };
    const result: TxResult = await db.$transaction(
      async (tx): Promise<TxResult> => {
        const lr = await tx.leaveRequest.findUnique({ where: { id } });
        if (!lr) return { error: "That leave request no longer exists. Refresh the page and try again." };
        const isOwner = lr.employeeId === user.employeeId;
        if (!isOwner && !isAdmin) {
          return { error: "You can only cancel your own leave requests." };
        }
        if (lr.status !== "PENDING" && lr.status !== "APPROVED") {
          return { error: `That request is already ${lr.status.toLowerCase()}. Refresh the page.` };
        }
        const wasApproved = lr.status === "APPROVED";

        if (!isAdmin) {
          if (user.accessLevel !== "FULL") return { error: READ_ONLY_MESSAGE };
          if (wasApproved && lr.startDate <= businessDateOnly()) {
            return {
              error:
                "Approved leave that has already started cannot be cancelled. Contact an admin if you need an adjustment.",
            };
          }
        } else if ((wasApproved || !isOwner) && !note) {
          return { error: "Enter a reason for cancelling this leave. The employee will see it." };
        }

        const res = await tx.leaveRequest.updateMany({
          where: { id, status: lr.status },
          data: {
            status: "CANCELLED",
            ...(isAdmin && !isOwner
              ? { reviewerId: user.employeeId ?? null, reviewedAt: new Date(), reviewNotes: note }
              : {}),
          },
        });
        if (res.count !== 1) return { error: "That request was just changed by someone else. Refresh the page." };
        return {
          employeeId: lr.employeeId,
          wasApproved,
          leaveType: lr.leaveType,
          startDate: lr.startDate,
          endDate: lr.endDate,
          byAdmin: isAdmin && !isOwner,
        };
      },
      { isolationLevel: "Serializable" },
    );
    if ("error" in result) return fail(result.error);

    await audit({
      action: result.byAdmin ? "leave.admin_cancel" : "leave.cancel",
      resource: `LeaveRequest:${id}`,
      diff: { wasApproved: result.wasApproved, reason: note, employeeId: result.employeeId },
    });
    const range = `${formatDateOnly(result.startDate)} to ${formatDateOnly(result.endDate)}`;
    if (result.byAdmin) {
      await notifyEmployees([result.employeeId], {
        type: "LEAVE",
        title: "Leave cancelled by an admin",
        message: `Your ${result.leaveType.toLowerCase()} leave (${range}) was cancelled.${note ? ` Reason: ${note}` : ""}`,
        link: "/dashboard/leave",
      });
    } else if (result.wasApproved) {
      await notifyAdmins({
        type: "LEAVE",
        title: "Approved leave cancelled",
        message: `An employee cancelled their approved ${result.leaveType.toLowerCase()} leave (${range}).`,
        link: "/admin/leave",
      });
    }
    revalidateLeave(result.employeeId);
    return ok();
  } catch (err) {
    if (isSerializationConflict(err)) return fail(CONFLICT_MESSAGE);
    return failFromUnknown(err);
  }
}

// ── Admin: balance adjustment ────────────────────────────────────────────

const adjustSchema = z.object({
  employeeId: z.string().min(1),
  leaveType: leaveTypeEnum,
  year: z.number().int().min(2000).max(2100),
  days: z.number().finite(),
  reason: z.string().trim().min(3, "Enter a reason (at least 3 characters).").max(500),
});

export async function adjustLeaveBalance(
  input: z.infer<typeof adjustSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  try {
    const data = adjustSchema.parse(input);
    const days = Math.round(data.days * 10) / 10;
    if (days === 0) return fail("Enter a non-zero number of days (use a minus sign to deduct).");
    if (Math.abs(days) > 365) return fail("That adjustment is too large.");

    const employee = await db.employee.findUnique({
      where: { id: data.employeeId },
      select: { id: true, name: true },
    });
    if (!employee) return fail("That employee no longer exists. Refresh the page.");

    const row = await db.leaveAdjustment.create({
      data: {
        employeeId: data.employeeId,
        year: data.year,
        leaveType: data.leaveType,
        days,
        reason: data.reason,
        createdById: admin.id,
      },
    });
    await audit({
      action: "leave.adjust",
      resource: `LeaveAdjustment:${row.id}`,
      diff: {
        employeeId: data.employeeId,
        year: data.year,
        leaveType: data.leaveType,
        days,
        reason: data.reason,
      },
    });
    await notifyEmployees([data.employeeId], {
      type: "LEAVE",
      title: "Leave balance adjusted",
      message: `Your ${data.leaveType.toLowerCase()} leave balance for ${data.year} was adjusted by ${days > 0 ? "+" : ""}${days} day(s). Reason: ${data.reason}`,
      link: "/dashboard/leave",
    });
    revalidateLeave(data.employeeId);
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ── Admin: policy editor ─────────────────────────────────────────────────

const policySchema = z.object({
  policies: z
    .array(
      z.object({
        leaveType: leaveTypeEnum,
        daysPerYear: z.number().finite().min(0).max(365),
        unlimited: z.boolean(),
        accrualMode: z.enum(["ANNUAL_GRANT", "MONTHLY"]),
        carryoverMax: z.number().finite().min(0).max(365),
      }),
    )
    .min(1),
});

export async function saveLeavePolicies(
  input: z.infer<typeof policySchema>,
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const { policies } = policySchema.parse(input);
    const before = await loadPolicies();
    const changes: Record<string, unknown> = {};
    await db.$transaction(async (tx) => {
      for (const p of policies) {
        const v = {
          daysPerYear: Math.round(p.daysPerYear * 10) / 10,
          unlimited: p.unlimited,
          accrualMode: p.accrualMode,
          carryoverMax: Math.round(p.carryoverMax * 10) / 10,
        };
        await tx.leavePolicy.upsert({
          where: { leaveType: p.leaveType },
          create: { leaveType: p.leaveType, ...v },
          update: v,
        });
        changes[p.leaveType] = { from: before[p.leaveType] ?? "default", to: v };
      }
    });
    await audit({ action: "leave.policy_update", resource: "LeavePolicy", diff: changes });
    revalidateLeave();
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
