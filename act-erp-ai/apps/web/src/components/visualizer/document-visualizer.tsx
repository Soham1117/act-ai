"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadPdf, type PDFDocumentProxy } from "@/lib/pdf";
import { PdfPage, type Highlight } from "./pdf-page";

/**
 * Self-contained PDF viewer on pdf.js: fit-width canvas, windowed page mounting,
 * jump-to-page via a nonce, citation highlights by 1-based page. Pure props in.
 */
type State = "loading" | "ready" | "error";

interface Props {
  pdfUrl: string;
  pageDimensions: Record<string, [number, number]>; // 0-based page index → [w,h]
  jumpTarget?: { page: number; nonce: number };
  highlights?: Record<number, Highlight[]>; // 1-based page → highlights
}

export function DocumentVisualizer({ pdfUrl, pageDimensions, jumpTarget, highlights = {} }: Props) {
  // Load result is keyed by pdfUrl, so the loading state is derived rather than
  // reset synchronously inside the effect.
  const [loaded, setLoaded] = useState<{
    url: string;
    doc: PDFDocumentProxy | null;
    numPages: number;
  } | null>(null);
  const current = loaded?.url === pdfUrl ? loaded : null;
  const doc = current?.doc ?? null;
  const numPages = current?.numPages ?? 0;
  const state: State = !current ? "loading" : current.doc ? "ready" : "error";
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState<Set<number>>(new Set([1, 2, 3]));

  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    let cancelled = false;
    loadPdf(pdfUrl)
      .then((d) => {
        if (!cancelled) setLoaded({ url: pdfUrl, doc: d, numPages: d.numPages });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ url: pdfUrl, doc: null, numPages: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.min(el.clientWidth - 32, 920));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || state !== "ready") return;
    const io = new IntersectionObserver(
      (entries) =>
        setNear((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const p = Number((e.target as HTMLElement).dataset.page);
            next.add(p - 1);
            next.add(p);
            next.add(p + 1);
          }
          return next;
        }),
      { root, rootMargin: "300px 0px" },
    );
    pageRefs.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [state, numPages]);

  const jumpPage = jumpTarget?.page;
  const jumpNonce = jumpTarget?.nonce;
  useEffect(() => {
    if (jumpPage === undefined || state !== "ready" || width === 0) return;
    const el = pageRefs.current.get(jumpPage);
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      setNear((prev) => new Set(prev).add(jumpPage).add(jumpPage + 1));
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(raf);
    // jumpNonce re-triggers the jump for the same page (repeat citation click).
  }, [jumpNonce, jumpPage, state, width]);

  const pages = useMemo(() => Array.from({ length: numPages }, (_, i) => i + 1), [numPages]);

  if (state === "loading")
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  if (state === "error")
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
        Could not load this document.
      </div>
    );

  return (
    <div ref={scrollRef} className="h-full overflow-auto bg-muted/40 px-4 py-5">
      <div className="space-y-5">
        {pages.map((p) => (
          <div
            key={p}
            data-page={p}
            ref={(el) => {
              if (el) pageRefs.current.set(p, el);
              else pageRefs.current.delete(p);
            }}
          >
            {width > 0 && doc && (
              <PdfPage
                doc={doc}
                pageNumber={p}
                width={width}
                markerDims={pageDimensions[String(p - 1)]}
                highlights={highlights[p]}
                visible={near.has(p)}
              />
            )}
            <div className="mt-1.5 text-center text-[11px] tabular-nums text-muted-foreground/60">{p}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
