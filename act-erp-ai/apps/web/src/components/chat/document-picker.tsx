"use client";

import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface PickerDoc {
  id: string;
  title: string;
  fileKind: string;
  status: string;
}

export function DocumentPicker({
  docs,
  selected,
  onToggle,
}: {
  docs: PickerDoc[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        Documents {selected.size > 0 ? `(${selected.size} selected)` : "(all)"}
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-2">
          {docs.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No documents available yet.
            </p>
          )}
          {docs.map((d) => (
            <label
              key={d.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <Checkbox checked={selected.has(d.id)} onCheckedChange={() => onToggle(d.id)} />
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-sm">{d.title}</span>
              {d.status !== "READY" && (
                <Badge variant="outline" className="text-[10px]">
                  {d.status.toLowerCase()}
                </Badge>
              )}
            </label>
          ))}
        </div>
      </ScrollArea>
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        No selection = search all documents you can access.
      </p>
    </div>
  );
}
