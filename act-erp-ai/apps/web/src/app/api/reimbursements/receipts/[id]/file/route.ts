import { getSessionUser } from "@/lib/auth";
import { getObjectStream } from "@/lib/storage";
import { db } from "@/lib/db";

// Streams a reimbursement receipt same-origin. Replaces the old pattern of
// persisting a presigned S3 URL in ReimbursementReceipt.fileUrl — every read
// now re-checks the caller owns the parent reimbursement (or is an admin).
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const receipt = await db.reimbursementReceipt.findUnique({
    where: { id },
    select: {
      fileName: true,
      mimeType: true,
      originalName: true,
      reimbursement: { select: { employeeId: true } },
    },
  });
  if (!receipt) return new Response("Not found", { status: 404 });
  if (user.role !== "ADMIN" && receipt.reimbursement.employeeId !== user.employeeId) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const { stream, contentType, contentLength } = await getObjectStream(
      `reimbursement-receipts/${receipt.fileName}`,
    );
    return new Response(stream, {
      headers: {
        "Content-Type": receipt.mimeType || contentType,
        ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
        "Content-Disposition": `inline; filename="${receipt.originalName.replace(/[^\w.\- ]/g, "_")}"`,
        // no-store: a shared/kiosk browser must never reuse this response for
        // a different logged-in user via its local HTTP cache.
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
