import { getSessionUser } from "@/lib/auth";
import { getObjectStream } from "@/lib/storage";
import { downloadHeaders } from "@/lib/upload-validation";

// Streams an employee's avatar same-origin. Any authenticated user may view a
// colleague's photo (it's shown org-wide — team page, admin lists) but the
// route still requires a session, unlike a raw presigned S3 URL would.
export const runtime = "nodejs";

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  try {
    const { stream, contentType } = await getObjectStream(`profile-pics/${id}/avatar`);
    // Never trust the stored content type: only known image types are served
    // inline, anything else falls back to a forced download.
    const ext = IMAGE_EXT[contentType.split(";")[0]!.trim().toLowerCase()];
    const headers = downloadHeaders({
      fileName: ext ? `avatar.${ext}` : "avatar",
      inline: !!ext,
    });
    headers["Cache-Control"] = "private, max-age=3600";
    return new Response(stream, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
