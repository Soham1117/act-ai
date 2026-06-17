"use client";

import { useState } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatComposer({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  }

  return (
    <div className="flex items-end gap-2 border-t p-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask about your documents…"
        rows={1}
        className="max-h-40 min-h-[40px] resize-none"
      />
      {busy ? (
        <Button variant="outline" size="icon" onClick={onStop} title="Stop">
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button size="icon" onClick={submit} disabled={!text.trim()} title="Send">
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
