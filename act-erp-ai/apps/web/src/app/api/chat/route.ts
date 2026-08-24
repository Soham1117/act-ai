import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { aiEnabled } from "@/lib/features";
import { allowedDocumentIds } from "@/lib/knowledge/access";
import { env } from "@/lib/env";

// Needs Prisma + the session (Node runtime). This is the ONLY path the browser
// uses to reach the agent: authenticate → compute the allowed doc scope
// server-side → proxy the agent's SSE stream. The browser never sees the agent
// service or sends a scope the model can trust.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!aiEnabled) {
    return new Response("AI assistant is not enabled on this deployment", { status: 503 });
  }
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const selected = Array.isArray(body.selected_doc_ids) ? body.selected_doc_ids : null;

  const allowed = await allowedDocumentIds(user);

  const upstream = await fetch(`${env.AGENT_SERVICE_URL}/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.INTERNAL_SERVICE_TOKEN}`,
    },
    body: JSON.stringify({
      user_id: user.id,
      allowed_doc_ids: allowed,
      selected_doc_ids: selected,
      messages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Agent service error", { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
