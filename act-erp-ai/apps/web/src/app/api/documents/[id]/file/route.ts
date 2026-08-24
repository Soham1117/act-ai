import { getSessionUser } from "@/lib/auth";
import { getObjectStream } from "@/lib/storage";
import { db } from "@/lib/db";

// Streams a personal/company document same-origin. Replaces the old pattern of
// persisting a presigned S3 URL in Document.fileUrl (a bearer credential with
// no session check and a 1h expiry) — every read now re-checks the caller's
// access.
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const doc = await db.document.findUnique({
    where: { id },
    select: { fileName: true, fileType: true, title: true, employeeId: true },
  });
  if (!doc) return new Response("Not found", { status: 404 });
  if (user.role !== "ADMIN" && doc.employeeId !== user.employeeId) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const { stream, contentType, contentLength } = await getObjectStream(`documents/${doc.fileName}`);
    return new Response(stream, {
      headers: {
        "Content-Type": doc.fileType || contentType,
        ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
        "Content-Disposition": `inline; filename="${doc.title.replace(/[^\w.\- ]/g, "_")}"`,
        // no-store: a shared/kiosk browser must never reuse this response for
        // a different logged-in user via its local HTTP cache.
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
