import { db } from "@/lib/db";

// Liveness/readiness probe for the compose healthcheck and uptime monitors.
// Public (see PUBLIC_PATHS in proxy.ts) and intentionally leaks nothing: no
// version, no error text, only ok / unavailable.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { status: 200, headers });
  } catch (e) {
    console.error("[health] database check failed", e);
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
