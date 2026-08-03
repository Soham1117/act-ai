"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { PDFDocumentProxy } from "@/lib/pdf";

/**
 * A single PDF page: a crisp canvas render (scaled by devicePixelRatio) with a
 * highlight overlay. The overlay SVG's viewBox is the page's Marker coordinate
 * space (preserveAspectRatio="none"), so citation bboxes/polygons drop in with no
 * client-side coordinate math.
 */
export interface Highlight {
  id: string;
  bbox?: [number, number, number, number];
  polygon?: number[][];
  active?: boolean;
}

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  markerDims?: [number, number];
  highlights?: Highlight[];
  visible: boolean;
}

export function PdfPage({ doc, pageNumber, width, markerDims, highlights = [], visible }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!visible || width === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / base.width });
        if (cancelled) return;
        setAspect(viewport.height / viewport.width);

        const canvas = canvasRef.current;
        if (!canvas) return;
        taskRef.current?.cancel();

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        const task = page.render({ canvasContext: ctx, viewport });
        taskRef.current = task;
        await task.promise;
        if (!cancelled) {
          setRendered(true);
          setError(false);
        }
      } catch (e) {
        if ((e as Error)?.name === "RenderingCancelledException") return;
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [doc, pageNumber, width, visible]);

  const height = aspect ? width * aspect : width * 1.294;

  return (
    <div
      className="relative mx-auto overflow-hidden rounded-lg border bg-white shadow-sm"
      style={{ width, height }}
    >
      {!rendered && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-destructive">
          Failed to render page {pageNumber}
        </div>
      )}
      <canvas ref={canvasRef} className="block h-full w-full" />
      {markerDims && highlights.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${markerDims[0]} ${markerDims[1]}`}
          preserveAspectRatio="none"
        >
          {highlights.map((h) => (
            <HighlightShape key={h.id} h={h} />
          ))}
        </svg>
      )}
    </div>
  );
}

function HighlightShape({ h }: { h: Highlight }) {
  const style: React.CSSProperties = {
    fill: "#fde047",
    fillOpacity: h.active ? 0.38 : 0.2,
    stroke: "#ca8a04",
    strokeOpacity: h.active ? 0.9 : 0.3,
  };
  if (h.polygon && h.polygon.length >= 3) {
    return <polygon points={h.polygon.map((p) => p.join(",")).join(" ")} style={style} strokeWidth={2} />;
  }
  if (h.bbox) {
    const [x0, y0, x1, y1] = h.bbox;
    return <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={3} style={style} strokeWidth={2} />;
  }
  return null;
}
