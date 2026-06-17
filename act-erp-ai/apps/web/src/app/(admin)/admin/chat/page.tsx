import { requireAdmin } from "@/lib/auth";
import { listAccessibleDocuments } from "@/lib/knowledge/access";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const metadata = { title: "Assistant" };

export default async function AdminChatPage() {
  const user = await requireAdmin();
  const docs = await listAccessibleDocuments(user);
  return (
    <ChatWorkspace
      docs={docs.map((d) => ({ id: d.id, title: d.title, fileKind: d.fileKind, status: d.status }))}
    />
  );
}
