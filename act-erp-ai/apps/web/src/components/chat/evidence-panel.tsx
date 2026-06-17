"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { CitationInfo } from "@/lib/chat/types";
import type { Highlight } from "@/components/visualizer/pdf-page";
import { DocumentVisualizer } from "@/components/visualizer/document-visualizer";
import { Button } from "@/components/ui/button";

interface DocView {
  pdfUrl: string | null;
  pageDimensions: Record<string, [number, number]>;
  title: string;
}

export function EvidencePanel({ citation, onClose }: { citation: CitationInfo | null; onClose: () => void }) {
  const [view, setView] = useState<DocView | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!citation) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/knowledge/${citation.document_id}/view`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("view failed"))))
      .then((d: DocView) => {
        if (cancelled) return;
        setView(d);
        setNonce((n) => n + 1);
      })
      .catch(() => !cancelled && setView(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [citation?.document_id]);

  if (!citation) return null;

  const page = citation.page ?? 1;
  const highlights: Record<number, Highlight[]> =
    citation.source_kind === "chunk" && (citation.bbox || citation.polygon)
      ? {
          [page]: [
            {
              id: citation.eid,
              bbox: citation.bbox as [number, number, number, number] | undefined,
              polygon: citation.polygon ?? undefined,
              active: true,
            },
          ],
        }
      : {};

  return (
    <div className="flex h-full flex-col border-l">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="truncate text-sm font-medium">
          {citation.eid} · {view?.title ?? "Source"}
          {citation.breadcrumb ? <span className="text-muted-foreground"> — {citation.breadcrumb}</span> : null}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : view?.pdfUrl ? (
          <DocumentVisualizer
            pdfUrl={view.pdfUrl}
            pageDimensions={view.pageDimensions}
            jumpTarget={{ page, nonce }}
            highlights={highlights}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {citation.source_kind === "row"
              ? "Structured record — no page view. The value is cited inline."
              : "No preview available for this document type."}
          </div>
        )}
      </div>
    </div>
  );
}
