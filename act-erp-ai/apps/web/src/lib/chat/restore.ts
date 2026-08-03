import type { CitationInfo, Turn } from "@/lib/chat/types";

/** Rebuild client Turn objects from persisted ChatMessage rows (oldest first).
 *  Messages are saved in user/assistant pairs; citations revive the [E#] chips. */
export function turnsFromMessages(
  messages: Array<{ role: string; content: string; citations: unknown }>,
): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      turns.push({
        user: m.content,
        assistant: { blocks: [], citations: {}, running: false },
      });
    } else if (turns.length > 0) {
      turns[turns.length - 1].assistant = {
        blocks: [{ kind: "text", text: m.content }],
        citations: (m.citations as Record<string, CitationInfo> | null) ?? {},
        running: false,
      };
    }
  }
  return turns;
}
