"use client";

import { useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ChatGPT-style composer: one rounded surface holding an auto-growing textarea,
 * a leading slot (document scope picker) and the send/stop control.
 */
export function ChatComposer({
  busy,
  onSend,
  onStop,
  leading,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  leading?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  function autoresize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
    requestAnimationFrame(autoresize);
  }

  return (
    <div className="rounded-2xl border bg-background shadow-sm transition-shadow focus-within:shadow-md">
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          autoresize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask about your documents…"
        rows={1}
        className="max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between px-2.5 pb-2 pt-1">
        <div className="flex items-center gap-1">{leading}</div>
        {busy ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={onStop}
            title="Stop"
            className="size-8 rounded-full"
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            onClick={submit}
            disabled={!text.trim()}
            title="Send"
            className="size-8 rounded-full"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
