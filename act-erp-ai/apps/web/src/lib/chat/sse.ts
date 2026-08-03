"use client";

import type { AgentEvent } from "./types";

/**
 * POST the conversation to the same-origin gateway (/api/chat, cookie auth) and
 * parse the SSE stream. fetch + ReadableStream (not EventSource — it can't POST).
 * The agent is stateless: we send the full message history each turn.
 */
export async function* streamChat(
  messages: { role: string; content: string }[],
  selectedDocIds: string[] | null,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, selected_doc_ids: selectedDocIds }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const ev = parseFrame(frame);
      if (ev) yield ev;
    }
  }
}

function parseFrame(frame: string): AgentEvent | null {
  let eventType = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventType = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { type: eventType, ...JSON.parse(dataLines.join("\n")) } as AgentEvent;
  } catch {
    return null;
  }
}
