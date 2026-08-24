import { getSessionUser } from "@/lib/auth";
import { aiEnabled } from "@/lib/features";
import { allowedDocumentIds } from "@/lib/knowledge/access";
import { db } from "@/lib/db";

// Returns the (same-origin, auth-checked) PDF URL + page dimensions for a
// document the user is allowed to see. The bytes stream via ./file — a direct
// signed S3 URL would require bucket CORS for pdf.js's browser fetch.
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!aiEnabled) return new Response("Not found", { status: 404 });
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const allowed = await allowedDocumentIds(user);
  if (!allowed.includes(id)) return new Response("Forbidden", { status: 403 });

  const doc = await db.knowledgeDocument.findUnique({
    where: { id },
    select: { fileKind: true, title: true, pageDimensions: true },
  });
  if (!doc) return new Response("Not found", { status: 404 });

  const pdfUrl = doc.fileKind === "PDF" ? `/api/knowledge/${id}/file` : null;
  return Response.json({ pdfUrl, pageDimensions: doc.pageDimensions ?? {}, title: doc.title });
}
