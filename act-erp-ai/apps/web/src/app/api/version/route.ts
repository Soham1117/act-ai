// Build id for the kiosk version watcher. Public (see PUBLIC_PATHS in proxy.ts)
// and harmless: it only says which build is running. The value is inlined at
// build time, so it matches the id in the client bundle of the same build.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "" },
    { headers: { "cache-control": "no-store" } },
  );
}
