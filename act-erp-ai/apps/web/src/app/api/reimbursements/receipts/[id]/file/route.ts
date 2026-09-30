import { getSessionUser } from "@/lib/auth";
import { storedFileResponse } from "@/lib/file-response";
import { db } from "@/lib/db";

// Streams a reimbursement receipt same-origin; every read re-checks the caller
// owns the parent reimbursement (or is an admin).
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  return storedFileResponse({
    req,
    key: `reimbursement-receipts/${receipt.fileName}`,
    title: receipt.originalName,
    storedName: receipt.fileName,
    fileType: receipt.mimeType,
  });
}
