"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth";

const broadcastSchema = z.object({
  type: z.enum(["PAYROLL", "COMPANY", "ANNOUNCEMENT", "POLICY", "OTHER"]),
  title: z.string().min(2).max(120),
  message: z.string().min(2),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  link: z.string().url().optional().or(z.literal("")),
  /** Empty/undefined → broadcast to all active employees. */
  employeeIds: z.array(z.string()).optional(),
  departmentIds: z.array(z.string()).optional(),
});

export async function broadcastNotification(input: z.infer<typeof broadcastSchema>) {
  const admin = await requireAdmin();
  const data = broadcastSchema.parse(input);

  // Resolve recipients.
  let recipients: { id: string }[] = [];
  if (data.employeeIds && data.employeeIds.length > 0) {
    recipients = data.employeeIds.map((id) => ({ id }));
  } else if (data.departmentIds && data.departmentIds.length > 0) {
    recipients = await db.employee.findMany({
      where: { employmentStatus: "ACTIVE", departmentId: { in: data.departmentIds } },
      select: { id: true },
    });
  } else {
    recipients = await db.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: { id: true },
    });
  }

  if (recipients.length === 0) throw new Error("No recipients matched");

  const created = await db.notification.create({
    data: {
      type: data.type,
      title: data.title,
      message: data.message,
      priority: data.priority,
      link: data.link || null,
      senderId: admin.id,
      recipients: {
        createMany: {
          data: recipients.map((r) => ({ employeeId: r.id })),
          skipDuplicates: true,
        },
      },
    },
  });

  revalidatePath("/admin/notifications");
  revalidatePath("/dashboard/notifications");
  return { ...created, recipientCount: recipients.length };
}

export async function markNotificationRead(notificationId: string) {
  const user = await requireUser();
  if (!user.employeeId) throw new Error("No employee record");
  await db.notificationRecipient.updateMany({
    where: { notificationId, employeeId: user.employeeId, read: false },
    data: { read: true, readAt: new Date() },
  });
  revalidatePath("/dashboard/notifications");
}

export async function markAllNotificationsRead() {
  const user = await requireUser();
  if (!user.employeeId) throw new Error("No employee record");
  await db.notificationRecipient.updateMany({
    where: { employeeId: user.employeeId, read: false },
    data: { read: true, readAt: new Date() },
  });
  revalidatePath("/dashboard/notifications");
}
