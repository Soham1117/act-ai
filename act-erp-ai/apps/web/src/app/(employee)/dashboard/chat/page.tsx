import { requireUser } from "@/lib/auth";
import { listAccessibleDocuments } from "@/lib/knowledge/access";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const metadata = { title: "Assistant" };

export default async function ChatPage() {
  const user = await requireUser();
  const docs = await listAccessibleDocuments(user);
  return (
    <ChatWorkspace
      docs={docs.map((d) => ({ id: d.id, title: d.title, fileKind: d.fileKind, status: d.status }))}
    />
  );
}
