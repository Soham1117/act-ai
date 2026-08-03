"use client";

import { useCallback, useRef, useState } from "react";
import { streamChat } from "@/lib/chat/sse";
import { emptyAssistant, reduce } from "@/lib/chat/reducer";
import { saveChatTurn } from "@/server/actions/chat-sessions";
import type { AssistantMessage, Turn } from "@/lib/chat/types";

/** Fired after a turn is persisted so the sidebar history list can refresh. */
export const CHAT_SAVED_EVENT = "act:chat-saved";

/**
 * Stateless chat: the agent service keeps no history, so we hold turns client-side
 * and resend the full conversation each send. `live` is the in-flight turn; folding
 * it into `history` on the next send keeps streaming from being clobbered.
 * Completed turns are persisted to the user's ChatSession (created on first turn)
 * so conversations survive reloads and appear under "Assistant" in the sidebar.
 */
export function useAgentChat(initial?: { sessionId: string; turns: Turn[] }) {
  const [history, setHistory] = useState<Turn[]>(initial?.turns ?? []);
  const [live, setLive] = useState<Turn | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef<Turn | null>(null);
  const sessionRef = useRef<string | null>(initial?.sessionId ?? null);

  const send = useCallback(async (message: string, selectedDocIds: string[] | null) => {
    setBusy(true);
    const prior = liveRef.current ? [...history, liveRef.current] : history;
    if (liveRef.current) setHistory(prior);

    const turn: Turn = { user: message, assistant: emptyAssistant() };
    liveRef.current = turn;
    setLive(turn);

    const applyLive = (fn: (a: AssistantMessage) => void) =>
      setLive((prev) => {
        if (!prev) return prev;
        const a: AssistantMessage = {
          ...prev.assistant,
          blocks: prev.assistant.blocks.map((b) => ({ ...b })),
          citations: { ...prev.assistant.citations },
        };
        fn(a);
        const next = { ...prev, assistant: a };
        liveRef.current = next;
        return next;
      });

    // build the message history the agent expects (prior turns + this message)
    const msgs: { role: string; content: string }[] = [];
    for (const t of prior) {
      msgs.push({ role: "user", content: t.user });
      const text = t.assistant.blocks
        .filter((b) => b.kind === "text")
        .map((b) => (b as { text: string }).text)
        .join("");
      if (text) msgs.push({ role: "assistant", content: text });
    }
    msgs.push({ role: "user", content: message });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      for await (const ev of streamChat(msgs, selectedDocIds, ctrl.signal)) {
        applyLive((a) => reduce(a, ev));
      }
    } catch (e) {
      applyLive((a) => a.blocks.push({ kind: "text", text: `\n\n_(error: ${(e as Error).message})_` }));
    } finally {
      applyLive((a) => (a.running = false));
      setBusy(false);

      // Persist the completed turn (fire-and-forget; chat keeps working if it fails).
      const done = liveRef.current;
      const assistantText = done
        ? done.assistant.blocks
            .filter((b) => b.kind === "text")
            .map((b) => (b as { text: string }).text)
            .join("")
        : "";
      if (done && assistantText.trim()) {
        saveChatTurn({
          sessionId: sessionRef.current,
          userText: done.user,
          assistantText,
          citations: done.assistant.citations,
        })
          .then((r) => {
            sessionRef.current = r.sessionId;
            window.dispatchEvent(new CustomEvent(CHAT_SAVED_EVENT));
          })
          .catch(() => {});
      }
    }
  }, [history]);

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const turns = live ? [...history, live] : history;
  return { turns, busy, send, stop };
}
