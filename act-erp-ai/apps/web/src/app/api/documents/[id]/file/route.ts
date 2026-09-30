import { getSessionUser } from "@/lib/auth";
import { storedFileResponse } from "@/lib/file-response";
import { db } from "@/lib/db";

// Streams a document same-origin. Visibility rule (shared with
// listMyDocuments and the employee documents page): an employee may open
// exactly the Document rows whose employeeId is theirs; admins may open any.
// Read-only (terminated, in grace) employees can still open their own.
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  return storedFileResponse({
    req,
    key: `documents/${doc.fileName}`,
    title: doc.title,
    storedName: doc.fileName,
    fileType: doc.fileType,
  });
}
