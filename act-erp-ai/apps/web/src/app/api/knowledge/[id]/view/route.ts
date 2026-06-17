import { getSessionUser } from "@/lib/auth";
import { allowedDocumentIds } from "@/lib/knowledge/access";
import { signedUrlForKey } from "@/lib/storage";
import { db } from "@/lib/db";

// Returns a short-lived signed PDF URL + page dimensions for a document the user
// is allowed to see. Scope is checked server-side (allowedDocumentIds).
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const allowed = await allowedDocumentIds(user);
  if (!allowed.includes(id)) return new Response("Forbidden", { status: 403 });

  const doc = await db.knowledgeDocument.findUnique({
    where: { id },
    select: { s3Key: true, fileKind: true, title: true, pageDimensions: true },
  });
  if (!doc) return new Response("Not found", { status: 404 });

  const pdfUrl = doc.fileKind === "PDF" ? await signedUrlForKey(doc.s3Key) : null;
  return Response.json({ pdfUrl, pageDimensions: doc.pageDimensions ?? {}, title: doc.title });
}
