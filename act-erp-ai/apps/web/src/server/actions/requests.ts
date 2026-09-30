"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requireAdmin,
  requireWritableUser,
  ReadOnlyAccountError,
  type SessionUser,
} from "@/lib/auth";
import { audit } from "@/lib/audit";
import { READ_ONLY_MESSAGE } from "@/lib/access";
import { notifyAdmins, notifyEmployees } from "@/lib/notify";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { REQUEST_TRANSITIONS, type RequestStatusKey } from "@/lib/request-transitions";

function revalidateRequests() {
  revalidatePath("/dashboard/requests");
  revalidatePath("/dashboard");
  revalidatePath("/admin/requests");
}

async function writableOrFail(): Promise<{ user: SessionUser } | { error: string }> {
  try {
    return { user: await requireWritableUser() };
  } catch (err) {
    if (err instanceof ReadOnlyAccountError) return { error: READ_ONLY_MESSAGE };
    throw err;
  }
}

const submitSchema = z.object({
  type: z.enum([
    "DOCUMENT_REQUEST", "DETAILS_CHANGE", "LEAVE_REQUEST", "PAYROLL_INQUIRY",
    "SCHEDULE_CHANGE", "ACCESS_REQUEST", "TRAINING_REQUEST", "EQUIPMENT_REQUEST",
    "LOCATION_CHANGE", "TEAM_REQUEST", "PROJECT_REQUEST", "BENEFITS_INQUIRY", "OTHER",
  ]),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(5000),
});

export async function submitRequest(
  input: z.infer<typeof submitSchema>,
): Promise<ActionResult<{ id: string }>> {
  const w = await writableOrFail();
  if ("error" in w) return fail(w.error);
  const user = w.user;
  if (!user.employeeId) {
    return fail(
      "Your account has no employee profile yet. Ask an admin to create one before you can submit a request.",
    );
  }
  try {
    const data = submitSchema.parse(input);
    if (data.type === "LEAVE_REQUEST") {
      return fail(
        "Time off is requested from the Leave page, where your balance and dates are checked. Open Leave and use Request leave.",
      );
    }

    const created = await db.$transaction(async (tx) => {
      const r = await tx.request.create({
        data: {
          employeeId: user.employeeId!,
          type: data.type,
          title: data.title,
          description: data.description,
        },
      });
      await tx.requestStatusHistory.create({
        data: {
          requestId: r.id,
          status: "PENDING",
          note: "Submitted by employee",
          updatedById: user.employeeId,
        },
      });
      return r;
    });
    await audit({
      action: "request.submit",
      resource: `Request:${created.id}`,
      diff: { type: data.type, title: data.title },
    });
    await notifyAdmins({
      type: "REQUEST",
      title: "New employee request",
      message: `${user.name} submitted "${data.title}" (${data.type.replace(/_/g, " ").toLowerCase()}).`,
      link: "/admin/requests",
    });
    revalidateRequests();
    return ok({ id: created.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ── Admin: status transitions ────────────────────────────────────────────

const updateStatusSchema = z.object({
  requestId: z.string(),
  status: z.enum(["PROCESSING", "COMPLETED", "REJECTED"]),
  note: z.string().max(2000).optional(),
});

export async function updateRequestStatus(
  input: z.infer<typeof updateStatusSchema>,
): Promise<ActionResult<{ id: string; status: string }>> {
  const admin = await requireAdmin();
  try {
    const data = updateStatusSchema.parse(input);
    const note = data.note?.trim() || null;
    if (data.status === "REJECTED" && !note) {
      return fail("Enter a reason for rejecting this request. The employee will see it.");
    }
    return await transition(admin, data.requestId, data.status, note, "request.status");
  } catch (err) {
    return failFromUnknown(err);
  }
}

const reopenSchema = z.object({
  requestId: z.string(),
  note: z.string().trim().min(2, "Enter a reason for reopening.").max(2000),
});

/** Explicit admin-only path out of a terminal state (COMPLETED / REJECTED -> PENDING). */
export async function reopenRequest(
  input: z.infer<typeof reopenSchema>,
): Promise<ActionResult<{ id: string; status: string }>> {
  const admin = await requireAdmin();
  try {
    const data = reopenSchema.parse(input);
    return await transition(admin, data.requestId, "PENDING", data.note, "request.reopen", true);
  } catch (err) {
    return failFromUnknown(err);
  }
}

async function transition(
  admin: SessionUser,
  requestId: string,
  to: RequestStatusKey,
  note: string | null,
  auditAction: string,
  isReopen = false,
): Promise<ActionResult<{ id: string; status: string }>> {
  type TxResult = { error: string } | { employeeId: string; title: string; from: string };
  const result: TxResult = await db.$transaction(async (tx): Promise<TxResult> => {
    const cur = await tx.request.findUnique({ where: { id: requestId } });
    if (!cur) return { error: "That request no longer exists. Refresh the page." };
    const allowed = isReopen
      ? cur.status === "COMPLETED" || cur.status === "REJECTED"
      : REQUEST_TRANSITIONS[cur.status].includes(to);
    if (!allowed) {
      return {
        error: isReopen
          ? "Only completed or rejected requests can be reopened."
          : `A ${cur.status.toLowerCase()} request cannot be moved to ${to.toLowerCase()}. Refresh the page.`,
      };
    }
    const res = await tx.request.updateMany({
      where: { id: requestId, status: cur.status },
      data: {
        status: to,
        adminNotes: note ?? undefined,
        reviewerId: admin.employeeId ?? undefined,
      },
    });
    if (res.count !== 1) return { error: "That request was just changed by someone else. Refresh the page." };
    await tx.requestStatusHistory.create({
      data: {
        requestId,
        status: to,
        note: note ?? (isReopen ? "Reopened" : null),
        updatedById: admin.employeeId ?? null,
      },
    });
    return { employeeId: cur.employeeId, title: cur.title, from: cur.status };
  });
  if ("error" in result) return fail(result.error);

  await audit({
    action: auditAction,
    resource: `Request:${requestId}`,
    diff: { from: result.from, to, note },
  });
  const verb =
    to === "PROCESSING" ? "is being processed"
    : to === "COMPLETED" ? "was completed"
    : to === "REJECTED" ? "was rejected"
    : "was reopened";
  await notifyEmployees([result.employeeId], {
    type: "REQUEST",
    title: `Request ${to.toLowerCase()}`,
    message: `Your request "${result.title}" ${verb}.${note ? ` Note: ${note}` : ""}`,
    link: "/dashboard/requests",
  });
  revalidateRequests();
  return ok({ id: requestId, status: to });
}

// ── Employee: cancel own pending request ─────────────────────────────────

/**
 * The schema has no CANCELLED status, so a withdrawn request is recorded as
 * REJECTED with a history note "Withdrawn by employee".
 */
export async function cancelRequest(requestId: string): Promise<ActionResult> {
  const w = await writableOrFail();
  if ("error" in w) return fail(w.error);
  const user = w.user;
  try {
    if (!user.employeeId) return fail("Your account has no employee profile.");
    type TxResult = { error: string } | { title: string };
    const result: TxResult = await db.$transaction(async (tx): Promise<TxResult> => {
      const cur = await tx.request.findUnique({ where: { id: requestId } });
      if (!cur || cur.employeeId !== user.employeeId) {
        return { error: "That request no longer exists. Refresh the page." };
      }
      if (cur.status !== "PENDING") {
        return {
          error: "Only requests that haven't been picked up yet can be withdrawn. Contact an admin.",
        };
      }
      const res = await tx.request.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: { status: "REJECTED" },
      });
      if (res.count !== 1) return { error: "That request was just updated. Refresh the page." };
      await tx.requestStatusHistory.create({
        data: {
          requestId,
          status: "REJECTED",
          note: "Withdrawn by employee",
          updatedById: user.employeeId,
        },
      });
      return { title: cur.title };
    });
    if ("error" in result) return fail(result.error);
    await audit({ action: "request.cancel", resource: `Request:${requestId}`, diff: { title: result.title } });
    await notifyAdmins({
      type: "REQUEST",
      title: "Request withdrawn",
      message: `${user.name} withdrew their request "${result.title}".`,
      link: "/admin/requests",
    });
    revalidateRequests();
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
