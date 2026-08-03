"use client";

import type { CitationInfo } from "@/lib/chat/types";

/** Inline [E#] chip. Clicking opens the source in the evidence panel. */
export function CitationChip({
  eid,
  citation,
  onSelect,
}: {
  eid: string;
  citation?: CitationInfo;
  onSelect: (c: CitationInfo) => void;
}) {
  const resolved = Boolean(citation);
  return (
    <button
      type="button"
      disabled={!resolved}
      onClick={() => citation && onSelect(citation)}
      title={citation?.breadcrumb ?? undefined}
      className={
        "mx-0.5 inline-flex items-center rounded px-1 text-[11px] font-medium align-baseline " +
        (resolved
          ? "bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer"
          : "bg-destructive/10 text-destructive cursor-not-allowed")
      }
    >
      {eid}
    </button>
  );
}
