"use client";

import { useState } from "react";
import { Check, ChevronDown, FileText, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface PickerDoc {
  id: string;
  title: string;
  fileKind: string;
  status: string;
}

/**
 * Document scope selector as a composer button + popover (no sidebar).
 * Empty selection = search everything the user can access.
 */
export function DocumentPickerButton({
  docs,
  selected,
  onToggle,
  onClear,
}: {
  docs: PickerDoc[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = query
    ? docs.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
    : docs;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {selected.size > 0 ? `${selected.size} document${selected.size === 1 ? "" : "s"}` : "All documents"}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <div className="border-b p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter documents…"
            className="w-full rounded-md bg-muted/60 px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {docs.length === 0 ? "No documents available yet." : "No matches."}
            </p>
          )}
          {filtered.map((d) => {
            const checked = selected.has(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onToggle(d.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border",
                    checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                  )}
                >
                  {checked && <Check className="h-3 w-3" />}
                </span>
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{d.title}</span>
                {d.status !== "READY" && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {d.status.toLowerCase()}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground">
            {selected.size > 0 ? "Searching only selected" : "No selection = search all"}
          </span>
          {selected.size > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClear}>
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
