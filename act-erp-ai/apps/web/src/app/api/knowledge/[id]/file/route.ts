import { getSessionUser } from "@/lib/auth";
import { aiEnabled } from "@/lib/features";
import { allowedDocumentIds } from "@/lib/knowledge/access";
import { getObjectStream } from "@/lib/storage";
import { db } from "@/lib/db";

// Streams the document bytes same-origin for the visualizer (pdf.js). A direct
// browser fetch to S3/LocalStack would need bucket CORS; proxying avoids that
// and keeps scope enforcement on every read.
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
    select: { s3Key: true, mimeType: true, sourceFilename: true },
  });
  if (!doc) return new Response("Not found", { status: 404 });

  const { stream, contentType, contentLength } = await getObjectStream(doc.s3Key);
  return new Response(stream, {
    headers: {
      "Content-Type": doc.mimeType || contentType,
      ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
      "Content-Disposition": `inline; filename="${doc.sourceFilename.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
