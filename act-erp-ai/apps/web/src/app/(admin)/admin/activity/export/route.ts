import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { csvRow } from "@/lib/payroll-overtime";
import { activityWhere } from "@/server/queries/activity";

// Admin-only CSV export of the audit log (same q/action filters as the page).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 50_000;

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "ADMIN") return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const action = url.searchParams.get("action")?.trim() ?? "";

  const rows = await db.auditLog.findMany({
    where: activityWhere(q, action),
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
    select: {
      createdAt: true,
      actorEmail: true,
      action: true,
      resource: true,
      ip: true,
      diff: true,
    },
  });

  const lines = [csvRow(["Time (UTC)", "Actor", "Action", "Resource", "IP", "Details (JSON)"])];
  for (const r of rows) {
    lines.push(
      csvRow([
        r.createdAt.toISOString(),
        r.actorEmail ?? "system",
        r.action,
        r.resource,
        r.ip,
        r.diff ? JSON.stringify(r.diff) : "",
      ]),
    );
  }

  await audit({
    action: "activity.export",
    resource: "AuditLog",
    diff: { q, action, rows: rows.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("\uFEFF" + lines.join("\r\n") + "\r\n", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="activity-${stamp}.csv"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
