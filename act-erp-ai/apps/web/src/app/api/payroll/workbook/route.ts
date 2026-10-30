import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { loadPayrollWorkbook } from "@/server/payroll-workbook-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/payroll/workbook?period=<payroll period id>&count=3 — admin only.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "ADMIN") return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "";
  const count = Number(url.searchParams.get("count") ?? "3") || 3;
  if (!period) return new Response("Missing period", { status: 400 });

  const result = await loadPayrollWorkbook(period, count);
  if (!result) return new Response("Pay period not found", { status: 404 });

  await audit({
    action: "payroll.workbook_download",
    resource: `PayrollCalendar:${period}`,
    diff: { periods: result.periods, from: result.from, to: result.to, pendingEntries: result.pendingCount },
  });
  return new Response(new Uint8Array(result.xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
