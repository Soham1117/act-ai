import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { aiEnabled } from "@/lib/features";
import { listAccessibleDocuments } from "@/lib/knowledge/access";
import { getChatSessionMessages } from "@/server/actions/chat-sessions";
import { turnsFromMessages } from "@/lib/chat/restore";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const metadata = { title: "Assistant" };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  if (!aiEnabled) notFound();
  const user = await requireUser();
  const { session: sessionId } = await searchParams;
  const docs = await listAccessibleDocuments(user);

  let initialSession: { sessionId: string; turns: ReturnType<typeof turnsFromMessages> } | undefined;
  if (sessionId) {
    const session = await getChatSessionMessages(sessionId);
    if (session) initialSession = { sessionId: session.id, turns: turnsFromMessages(session.messages) };
  }

  return (
    <ChatWorkspace
      key={sessionId ?? "new"}
      docs={docs.map((d) => ({ id: d.id, title: d.title, fileKind: d.fileKind, status: d.status }))}
      initialSession={initialSession}
    />
  );
}
