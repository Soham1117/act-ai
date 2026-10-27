import { db } from "@/lib/db";
import type { NotificationType, Priority } from "@prisma/client";

type Payload = {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  priority?: Priority;
  translationKey?: string;
  translationParams?: Record<string, string | number>;
};

/**
 * Create an in-app notification for specific employees. Never throws — a
 * failed notification must not roll back or fail the business action.
 */
export async function notifyEmployees(employeeIds: string[], p: Payload): Promise<void> {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (ids.length === 0) return;
  try {
    await db.notification.create({
      data: {
        type: p.type,
        title: p.title.slice(0, 200),
        message: p.message,
        priority: p.priority ?? "MEDIUM",
        link: p.link ?? null,
        ...(p.translationKey ? { translationKey: p.translationKey, translationParams: p.translationParams ?? {} } : {}),
        recipients: { createMany: { data: ids.map((employeeId) => ({ employeeId })), skipDuplicates: true } },
      },
    });
  } catch (e) {
    console.error("[notify] failed", e);
  }
}

/**
 * Notify every ACTIVE admin who has an employee record (notifications are
 * keyed by employee). Admins without an employee record are not reachable
 * in-app.
 */
export async function notifyAdmins(p: Payload): Promise<void> {
  try {
    const admins = await db.employee.findMany({
      where: { employmentStatus: "ACTIVE", user: { role: "ADMIN" } },
      select: { id: true },
    });
    await notifyEmployees(admins.map((a) => a.id), p);
  } catch (e) {
    console.error("[notify] admins failed", e);
  }
}
