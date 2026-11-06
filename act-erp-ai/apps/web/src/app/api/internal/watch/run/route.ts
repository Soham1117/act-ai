import { timingSafeEqual } from "node:crypto";
import { runWatch } from "@/server/watch/runner";

// Called by the host cron. Public in proxy.ts (no browser session) and
// protected by its own bearer token, WATCH_CRON_TOKEN. Fails closed when unset.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };

function authorized(req: Request): boolean {
  const expected = process.env.WATCH_CRON_TOKEN;
  if (!expected || expected.length < 24) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401, headers });
  try {
    const result = await runWatch({ trigger: "SCHEDULE", shadow: false });
    return Response.json(result, { headers });
  } catch (e) {
    console.error("[watch] run failed", e);
    return Response.json({ error: "failed" }, { status: 500, headers });
  }
}
