"use client";

import { useEffect, useRef, useState } from "react";
import { useAgentChat } from "@/hooks/use-agent-chat";
import type { CitationInfo, Turn } from "@/lib/chat/types";
import { AssistantMessageView } from "./assistant-message";
import { ChatComposer } from "./chat-composer";
import { DocumentPickerButton, type PickerDoc } from "./document-picker";
import { EvidencePanel } from "./evidence-panel";

/**
 * Full-viewport chat (ChatGPT layout): one centered column — messages scroll,
 * composer pinned at the bottom with the document-scope picker inside it. A
 * citation click opens the evidence panel (PDF visualizer) on the right. The
 * parent layout adds p-4/md:p-6 and a sticky h-14 topbar — negative margins
 * cancel the padding so the workspace is exactly 100svh with no page scroll.
 */
export function ChatWorkspace({
  docs,
  initialSession,
}: {
  docs: PickerDoc[];
  initialSession?: { sessionId: string; turns: Turn[] };
}) {
  const { turns, busy, send, stop } = useAgentChat(initialSession);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [citation, setCitation] = useState<CitationInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleSend = (text: string) => send(text, selected.size ? [...selected] : null);

  // Follow the stream: stick to the bottom unless the user scrolled away.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  });

  const picker = (
    <DocumentPickerButton
      docs={docs}
      selected={selected}
      onToggle={toggle}
      onClear={() => setSelected(new Set())}
    />
  );

  return (
    <div className="-m-4 flex h-[calc(100svh-3.5rem)] overflow-hidden md:-m-6">
      <section className="flex h-full min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
            {turns.length === 0 && (
              <div className="flex h-[55svh] flex-col items-center justify-center gap-2 text-center">
                <p className="text-lg font-semibold">What do you want to look up?</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Tool manuals, BOMs, spec sheets, inspection reports — answers come with
                  citations you can click to see the exact source passage.
                </p>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className="space-y-3">
                <div className="ml-auto w-fit max-w-[80%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">
                  {t.user}
                </div>
                <AssistantMessageView message={t.assistant} onCite={setCitation} />
              </div>
            ))}
          </div>
        </div>
        <div className="shrink-0 px-4 pb-4 pt-1">
          <div className="mx-auto w-full max-w-3xl">
            <ChatComposer busy={busy} onSend={handleSend} onStop={stop} leading={picker} />
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground/70">
              Answers are grounded in your documents — click an [E#] to see the source.
            </p>
          </div>
        </div>
      </section>

      {citation && (
        <aside className="w-[clamp(320px,38vw,560px)] shrink-0">
          <EvidencePanel citation={citation} onClose={() => setCitation(null)} />
        </aside>
      )}
    </div>
  );
}
