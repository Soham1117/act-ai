import { getActiveKioskSession } from "@/server/actions/kiosk";
import { db } from "@/lib/db";
import { getObjectStream } from "@/lib/storage";
import { businessDateOnly } from "@/lib/format";
import { isContractWorkerEligible } from "@/lib/contract-workers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };

/** Roster photos stay private: only an activated terminal may read eligible people's photos. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!(await getActiveKioskSession(slug))) {
    return new Response("Unauthorized", { status: 401, headers: privateHeaders });
  }
  const query = new URL(req.url).searchParams;
  const type = query.get("type");
  const id = query.get("id");
  const side = query.get("side");
  const profile = query.get("profile") === "1";
  if (
    (type !== "employee" && type !== "contract") ||
    !id ||
    (!profile && side !== "in" && side !== "out")
  ) {
    return new Response("Bad request", { status: 400, headers: privateHeaders });
  }
  const select = { clockInPhotoKey: true, clockOutPhotoKey: true } as const;
  let key: string | null = null;
  if (profile && type === "employee") {
    const employee = await db.employee.findFirst({
      where: { id, employmentStatus: "ACTIVE" },
      select: { kioskProfilePhotoKey: true },
    });
    key = employee?.kioskProfilePhotoKey ?? null;
  } else if (profile) {
    const worker = await db.contractWorker.findUnique({
      where: { id },
      select: {
        kioskProfilePhotoKey: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    });
    if (worker && isContractWorkerEligible(worker, businessDateOnly())) {
      key = worker.kioskProfilePhotoKey;
    }
  } else if (type === "employee") {
    const entry = await db.timeEntry.findFirst({
      where: { id, employee: { employmentStatus: "ACTIVE" } },
      select,
    });
    key = (side === "in" ? entry?.clockInPhotoKey : entry?.clockOutPhotoKey) ?? null;
  } else {
    const entry = await db.contractTimeEntry.findUnique({
      where: { id },
      select: {
        ...select,
        contractWorker: { select: { status: true, startDate: true, endDate: true } },
      },
    });
    if (entry && isContractWorkerEligible(entry.contractWorker, businessDateOnly())) {
      key = (side === "in" ? entry.clockInPhotoKey : entry.clockOutPhotoKey) ?? null;
    }
  }
  if (!key) return new Response("Not found", { status: 404, headers: privateHeaders });
  try {
    const { stream, contentLength } = await getObjectStream(key);
    const headers: Record<string, string> = {
      ...privateHeaders,
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
    };
    if (contentLength) headers["Content-Length"] = String(contentLength);
    return new Response(stream, { headers });
  } catch {
    return new Response("Not found", { status: 404, headers: privateHeaders });
  }
}
