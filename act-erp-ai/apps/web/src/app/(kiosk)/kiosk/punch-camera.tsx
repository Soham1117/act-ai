"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useKioskLanguage } from "./kiosk-language";
import { CameraOff } from "lucide-react";
import { getCenterSquareCrop } from "@/lib/kiosk-photo-crop";
import { loadFaceDetector } from "@/lib/kiosk-face-detector";

export type PunchCameraStatus = "idle" | "starting" | "on" | "off";

export type PunchCamera = {
  /** Open the camera. Safe to call twice; only one stream is ever open. */
  start: () => void;
  /** Stop all tracks and clear the preview. Safe to call at any time. */
  stop: () => void;
  /**
   * JPEG of a frame with a face in it. `noFace` is true only when the camera and
   * detector both work but no face showed up; the punch must then be refused.
   * Any other failure gives `{ photo: null, noFace: false }` (never throws).
   */
  capture: () => Promise<PunchCapture>;
  /** Mirrored, center-cropped square JPEG for a profile photo. */
  captureProfile: () => Promise<string | null>;
  /** Callback ref for the preview <video>. It can mount before or after start(). */
  setVideo: (el: HTMLVideoElement | null) => void;
  status: PunchCameraStatus;
};

export type PunchCapture = { photo: string | null; noFace: boolean };

const READY_WAIT_MS = 1500;
const MAX_WIDTH = 480;
/** How long to keep looking for a face before refusing the punch. */
const FACE_WAIT_MS = 2000;
/** Fail open if the detector is still loading after this long. */
const DETECTOR_WAIT_MS = 4000;

/**
 * Best-effort front camera for punch photos. The stream runs only between
 * start() and stop(), so the camera light is off while nobody is punching.
 * If the camera is blocked or missing, the kiosk still works; capture() just
 * returns null.
 */
export function usePunchCamera(): PunchCamera {
  const elRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Bumped on every stop, so a start that resolves late can detect it is stale. */
  const genRef = useRef(0);
  /** True from start() until stop() or a failed start. Blocks a second stream. */
  const wantedRef = useRef(false);
  const [status, setStatus] = useState<PunchCameraStatus>("idle");

  const bind = useCallback((el: HTMLVideoElement, stream: MediaStream) => {
    if (el.srcObject !== stream) el.srcObject = stream;
    void el.play().catch(() => undefined);
  }, []);

  const setVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      elRef.current = el;
      if (el && streamRef.current) bind(el, streamRef.current);
    },
    [bind],
  );

  // Releases the hardware without touching state, so it is safe in cleanups.
  const release = useCallback(() => {
    genRef.current += 1;
    wantedRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (elRef.current) elRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setStatus("idle");
  }, [release]);

  const start = useCallback(() => {
    if (wantedRef.current) return;
    wantedRef.current = true;
    const gen = genRef.current;
    setStatus("starting");
    void loadFaceDetector(); // warm up while the person enters their PIN
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera api");
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640 },
          audio: false,
        });
        if (gen !== genRef.current) {
          // stop() ran while the permission prompt or device was still opening.
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (elRef.current) bind(elRef.current, s);
        setStatus("on");
      } catch {
        if (gen !== genRef.current) return;
        wantedRef.current = false;
        setStatus("off");
      }
    })();
  }, [bind]);

  const readyVideo = useCallback(async () => {
    const began = Date.now();
    for (;;) {
      const v = elRef.current;
      if (v && v.srcObject && v.readyState >= 2 && v.videoWidth > 0) return v;
      if (!wantedRef.current || Date.now() - began > READY_WAIT_MS) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
  }, []);

  const capture = useCallback(async (): Promise<PunchCapture> => {
    const none = { photo: null, noFace: false };
    try {
      const v = await readyVideo();
      if (!v) return none;
      const detector = await Promise.race([
        loadFaceDetector(),
        new Promise<null>((r) => setTimeout(() => r(null), DETECTOR_WAIT_MS)),
      ]);
      const scale = Math.min(1, MAX_WIDTH / v.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return none;
      const began = Date.now();
      for (;;) {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        let face = true; // fail open when the detector is unavailable
        if (detector) {
          try {
            face = detector.detect(canvas).detections.length > 0;
          } catch {
            face = true;
          }
        }
        if (face) {
          const url = canvas.toDataURL("image/jpeg", 0.7);
          return { photo: url.startsWith("data:image/jpeg") ? url : null, noFace: false };
        }
        if (Date.now() - began > FACE_WAIT_MS) return { photo: null, noFace: true };
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch {
      return none;
    }
  }, [readyVideo]);

  const captureProfile = useCallback(async () => {
    try {
      const v = await readyVideo();
      if (!v) return null;
      const crop = getCenterSquareCrop(v.videoWidth, v.videoHeight);
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, crop.x, crop.y, crop.width, crop.height, 0, 0, 480, 480);
      const url = canvas.toDataURL("image/jpeg", 0.85);
      if (!url.startsWith("data:image/jpeg")) return null;
      return atob(url.slice(url.indexOf(",") + 1)).length < 400 * 1024 ? url : null;
    } catch {
      return null;
    }
  }, [readyVideo]);

  useEffect(() => release, [release]);

  return { start, stop, capture, captureProfile, setVideo, status };
}

/** Small live preview for the confirm card. Shows "Camera off" if access failed. */
export function PunchCameraPreview({
  status,
  setVideo,
}: Pick<PunchCamera, "status" | "setVideo">) {
  const { t } = useKioskLanguage();
  const off = status === "off";
  return (
    <div className="mx-auto h-28 w-28 overflow-hidden rounded-xl border bg-muted shadow-sm">
      {/* Mirrored preview like a mirror; the saved photo is not mirrored. */}
      <video
        ref={setVideo}
        muted
        playsInline
        autoPlay
        className={off ? "hidden" : "h-full w-full -scale-x-100 object-cover"}
      />
      {off && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground">
          <CameraOff className="h-5 w-5" /> {t("Camera off")}{" "}
        </div>
      )}
    </div>
  );
}
