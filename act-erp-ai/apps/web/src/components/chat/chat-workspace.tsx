"use client";

import { useState } from "react";
import { useAgentChat } from "@/hooks/use-agent-chat";
import type { CitationInfo } from "@/lib/chat/types";
import { AssistantMessageView } from "./assistant-message";
import { ChatComposer } from "./chat-composer";
import { DocumentPicker, type PickerDoc } from "./document-picker";
import { EvidencePanel } from "./evidence-panel";

export function ChatWorkspace({ docs }: { docs: PickerDoc[] }) {
  const { turns, busy, send, stop } = useAgentChat();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [citation, setCitation] = useState<CitationInfo | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleSend = (text: string) => send(text, selected.size ? [...selected] : null);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      <aside className="w-64 shrink-0 border-r">
        <DocumentPicker docs={docs} selected={selected} onToggle={toggle} />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-6 overflow-auto p-4">
          {turns.length === 0 && (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
              Ask a question about your tool records, BOMs, or operational documents.
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className="space-y-2">
              <div className="ml-auto max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                {t.user}
              </div>
              <div className="max-w-[90%] rounded-lg bg-muted px-3 py-2">
                <AssistantMessageView message={t.assistant} onCite={setCitation} />
              </div>
            </div>
          ))}
        </div>
        <ChatComposer busy={busy} onSend={handleSend} onStop={stop} />
      </section>

      {citation && (
        <aside className="w-[42%] min-w-[360px] shrink-0">
          <EvidencePanel citation={citation} onClose={() => setCitation(null)} />
        </aside>
      )}
    </div>
  );
}
