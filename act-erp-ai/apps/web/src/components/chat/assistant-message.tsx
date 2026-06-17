"use client";

import { Fragment } from "react";
import { Loader2 } from "lucide-react";
import type { AssistantMessage, CitationInfo } from "@/lib/chat/types";
import { AgentActivity } from "./agent-activity";
import { CitationChip } from "./citation-chip";

const EID_RE = /(\[E\d+\])/g;

function renderText(text: string, citations: Record<string, CitationInfo>, onCite: (c: CitationInfo) => void) {
  return text.split(EID_RE).map((part, i) => {
    const m = part.match(/^\[(E\d+)\]$/);
    if (m) {
      const eid = m[1];
      return <CitationChip key={i} eid={eid} citation={citations[eid]} onSelect={onCite} />;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function AssistantMessageView({
  message,
  onCite,
}: {
  message: AssistantMessage;
  onCite: (c: CitationInfo) => void;
}) {
  const textBlocks = message.blocks.filter((b) => b.kind === "text");
  const clarification = message.blocks.find((b) => b.kind === "clarification");
  const confColor =
    message.confidence?.level === "high"
      ? "text-emerald-600"
      : message.confidence?.level === "medium"
        ? "text-amber-600"
        : "text-destructive";

  return (
    <div className="space-y-1">
      <AgentActivity blocks={message.blocks} />

      {textBlocks.map((b, i) => (
        <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
          {renderText((b as { text: string }).text, message.citations, onCite)}
        </p>
      ))}

      {message.running && textBlocks.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
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
        <p className={`text-[11px] ${confColor}`}>
          Confidence: {message.confidence.level} — {message.confidence.reason}
        </p>
      )}
    </div>
  );
}
