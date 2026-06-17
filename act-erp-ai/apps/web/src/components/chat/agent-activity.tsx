"use client";

import { Check, Loader2, Wrench } from "lucide-react";
import type { Block } from "@/lib/chat/types";

/** Renders the tool/thinking "activity" blocks of an assistant turn. */
export function AgentActivity({ blocks }: { blocks: Block[] }) {
  const activity = blocks.filter((b) => b.kind === "tool" || b.kind === "thinking");
  if (activity.length === 0) return null;
  return (
    <div className="mb-2 space-y-1">
      {activity.map((b, i) =>
        b.kind === "tool" ? (
          <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
            {b.done ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            <Wrench className="h-3 w-3 opacity-60" />
            <span>{b.done ? (b.summary ?? b.label) : b.label}</span>
            {b.done && b.durationMs ? (
              <span className="tabular-nums opacity-50">{b.durationMs}ms</span>
            ) : null}
          </div>
        ) : (
          <div key={i} className="border-l-2 pl-2 text-xs italic text-muted-foreground/80">
            {b.text}
          </div>
        ),
      )}
    </div>
  );
}
