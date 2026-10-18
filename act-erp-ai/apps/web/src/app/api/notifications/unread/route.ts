import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";

// Unread notification count for the current user (polled by the topbar badge,
// replacing Supabase Realtime).
export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  // No session (missing or revoked): say so, so the poller can stop quietly.
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  // Signed in without an employee record (for example a plain admin account).
  if (!user.employeeId) return Response.json({ unread: 0 });
  const unread = await db.notificationRecipient.count({
    where: { employeeId: user.employeeId, read: false },
  });
  return Response.json({ unread });
}
