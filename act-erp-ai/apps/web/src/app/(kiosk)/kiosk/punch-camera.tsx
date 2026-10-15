"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CameraOff } from "lucide-react";

export type PunchCameraHandle = {
  /** JPEG data URL of the current frame, or null on any failure (never throws). */
  capture: () => Promise<string | null>;
};

const READY_WAIT_MS = 1500;
const MAX_WIDTH = 480;

/**
 * Best-effort front camera for punch photos. Opens once on mount and keeps the
 * stream so a punch never waits for the camera to start. If the camera is
 * blocked or missing the kiosk still works; capture() just returns null.
 */
export const PunchCamera = forwardRef<PunchCameraHandle, { className?: string }>(
  function PunchCamera({ className }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [off, setOff] = useState(false);

    useEffect(() => {
      let stream: MediaStream | null = null;
      let cancelled = false;
      (async () => {
        try {
          if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera api");
          const s = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: 640 },
            audio: false,
          });
          if (cancelled) {
            s.getTracks().forEach((t) => t.stop());
            return;
          }
          stream = s;
          const v = videoRef.current;
          if (v) {
            v.srcObject = s;
            await v.play().catch(() => undefined);
          }
        } catch {
          if (!cancelled) setOff(true);
        }
      })();
      return () => {
        cancelled = true;
        stream?.getTracks().forEach((t) => t.stop());
      };
    }, []);

    useImperativeHandle(ref, () => ({
      async capture() {
        try {
          const v = videoRef.current;
          if (!v) return null;
          const start = Date.now();
          while (v.readyState < 2 || v.videoWidth === 0) {
            if (Date.now() - start > READY_WAIT_MS) return null;
            await new Promise((r) => setTimeout(r, 100));
          }
          const scale = Math.min(1, MAX_WIDTH / v.videoWidth);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(v.videoWidth * scale);
          canvas.height = Math.round(v.videoHeight * scale);
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const url = canvas.toDataURL("image/jpeg", 0.7);
          return url.startsWith("data:image/jpeg") ? url : null;
        } catch {
          return null;
        }
      },
    }));

    return (
      <div className={className}>
        <div className="h-24 w-24 overflow-hidden rounded-xl border bg-muted shadow-sm">
          {/* Mirrored preview like a mirror; the saved photo is not mirrored. */}
          <video
            ref={videoRef}
            muted
            playsInline
            className={off ? "hidden" : "h-full w-full -scale-x-100 object-cover"}
          />
          {off && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground">
              <CameraOff className="h-5 w-5" />
              Camera off
            </div>
          )}
        </div>
      </div>
    );
  },
);
