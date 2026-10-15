import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getObjectStream } from "@/lib/storage";
import { downloadHeaders } from "@/lib/upload-validation";

// Streams a kiosk punch photo same-origin. Admin only; objects are private.
export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "ADMIN") return new Response("Forbidden", { status: 403 });

  const q = new URL(req.url).searchParams;
  const type = q.get("type");
  const id = q.get("id");
  const side = q.get("side");
  if ((type !== "employee" && type !== "contract") || !id || (side !== "in" && side !== "out")) {
    return new Response("Bad request", { status: 400 });
  }

  const select = { clockInPhotoKey: true, clockOutPhotoKey: true } as const;
  const row =
    type === "employee"
      ? await db.timeEntry.findUnique({ where: { id }, select })
      : await db.contractTimeEntry.findUnique({ where: { id }, select });
  const key = side === "in" ? row?.clockInPhotoKey : row?.clockOutPhotoKey;
  if (!key) return new Response("Not found", { status: 404 });

  try {
    const { stream, contentLength } = await getObjectStream(key);
    const headers = downloadHeaders({ fileName: `punch-${side}.jpg`, inline: true });
    headers["Content-Type"] = "image/jpeg";
    if (contentLength) headers["Content-Length"] = String(contentLength);
    return new Response(stream, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
