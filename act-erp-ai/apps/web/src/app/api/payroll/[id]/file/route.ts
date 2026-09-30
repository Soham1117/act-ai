import { getSessionUser } from "@/lib/auth";
import { storedFileResponse } from "@/lib/file-response";
import { db } from "@/lib/db";

// Streams a payroll document (paystub) same-origin. Every read re-checks the
// caller owns this record (or is an admin). Read-only (terminated, in grace)
// employees may still download their own documents — getSessionUser resolves
// them as long as their access level is not NONE.
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const doc = await db.payroll.findUnique({
    where: { id },
    select: { fileName: true, fileType: true, title: true, employeeId: true },
  });
  if (!doc) return new Response("Not found", { status: 404 });
  if (user.role !== "ADMIN" && doc.employeeId !== user.employeeId) {
    return new Response("Forbidden", { status: 403 });
  }

  return storedFileResponse({
    req,
    key: `payroll/${doc.fileName}`,
    title: doc.title,
    storedName: doc.fileName,
    fileType: doc.fileType,
  });
}
