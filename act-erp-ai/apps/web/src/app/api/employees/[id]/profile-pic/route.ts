import { getSessionUser } from "@/lib/auth";
import { getObjectStream } from "@/lib/storage";

// Streams an employee's avatar same-origin. Any authenticated user may view a
// colleague's photo (it's shown org-wide — team page, admin lists) but the
// route still requires a session, unlike a raw presigned S3 URL would.
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  try {
    const { stream, contentType } = await getObjectStream(`profile-pics/${id}/avatar`);
    return new Response(stream, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
