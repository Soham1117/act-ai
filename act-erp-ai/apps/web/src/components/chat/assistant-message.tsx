"use client";

import { Loader2 } from "lucide-react";
import type { AssistantMessage, CitationInfo } from "@/lib/chat/types";
import { AgentActivity } from "./agent-activity";
import { TextBlock } from "./text-block";

export function AssistantMessageView({
  message,
  onCite,
}: {
  message: AssistantMessage;
  onCite: (c: CitationInfo) => void;
}) {
  const textBlocks = message.blocks.filter((b) => b.kind === "text");
  const clarification = message.blocks.find((b) => b.kind === "clarification");
  const evidenceCount = Object.keys(message.citations).length;
  const confColor =
    message.confidence?.level === "high"
      ? "text-emerald-600"
      : message.confidence?.level === "medium"
        ? "text-amber-600"
        : "text-destructive";

  return (
    <div className="space-y-2">
      <AgentActivity blocks={message.blocks} running={message.running} evidenceCount={evidenceCount} />

      {textBlocks.map((b, i) => (
        <TextBlock
          key={i}
          text={(b as { text: string }).text}
          citations={message.citations}
          onCite={onCite}
        />
      ))}

      {message.running && textBlocks.length === 0 && (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
        </div>
      )}

      {clarification && clarification.kind === "clarification" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">{clarification.question}</p>
          {clarification.options.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{clarification.options.join(" · ")}</p>
          )}
        </div>
      )}

      {message.confidence && !message.running && (
        <p className={`px-1 text-[11px] ${confColor}`}>
          Confidence: {message.confidence.level} — {message.confidence.reason}
        </p>
      )}
    </div>
  );
}
