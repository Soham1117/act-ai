"use client";

/* The React compiler lint misclassifies the camera status and callback ref. */
/* eslint-disable react-hooks/refs */

import { useState } from "react";
import { Camera, Loader2, RotateCcw } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { useKioskLanguage } from "./kiosk-language";
import type { PunchCamera } from "./punch-camera";

export function KioskProfilePhotoEditor({
  punchCamera,
  onSave,
  onSaved,
  onClose,
  onBusyChange,
}: {
  punchCamera: PunchCamera;
  onSave: (pin: string, photo: string) => Promise<ActionResult<{ url: string }>>;
  onSaved: (url: string) => void;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t, toastAction } = useKioskLanguage();
  const [pin, setPin] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [captureError, setCaptureError] = useState(false);
  const cameraStatus = punchCamera.status;

  async function capture() {
    setCapturing(true);
    setCaptureError(false);
    const result = await punchCamera.captureProfile();
    setCapturing(false);
    if (!result) {
      setCaptureError(true);
      return;
    }
    setPhoto(result);
  }

  async function save() {
    if (!photo || !/^\d{4}$/.test(pin) || saving) return;
    setSaving(true);
    onBusyChange(true);
    try {
      const result = await onSave(pin, photo);
      if (!toastAction(result)) {
        setPin("");
        return;
      }
      onSaved(result.url);
      setPin("");
      onClose();
    } catch {
      toastAction({
        ok: false,
        error: "Could not reach the server. Check the connection and try again.",
      });
      setPin("");
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  }

  const cameraOff = cameraStatus === "off" || cameraStatus === "idle";
  const cameraStarting = cameraStatus === "starting";

  return (
    <div className="space-y-4">
      <p className="text-center text-sm font-semibold">{t("Change photo")}</p>
      <div className="mx-auto aspect-square w-full max-w-64 overflow-hidden rounded-full border bg-muted">
        {photo ? (
          <Image
            src={photo}
            alt={t("Photo preview")}
            width={480}
            height={480}
            unoptimized
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <div className="relative h-full w-full overflow-hidden rounded-full">
            {cameraStatus === "on" && (
              <video
                ref={punchCamera.setVideo}
                muted
                playsInline
                autoPlay
                className="h-full w-full -scale-x-100 object-cover"
              />
            )}
            {cameraStatus !== "on" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                {cameraStarting ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <Camera className="h-6 w-6" />
                )}
                {cameraStarting ? t("Starting camera…") : t("Camera unavailable")}
              </div>
            )}
            <div className="pointer-events-none absolute inset-[15%] rounded-full border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.25)]" />
          </div>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {photo ? t("Review your photo") : t("Center your face inside the guide")}
      </p>
      {captureError && (
        <p role="alert" className="text-center text-xs text-destructive">
          {t("Photo capture failed. Try again.")}
        </p>
      )}
      {cameraOff && !photo && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => punchCamera.start()}
        >
          <Camera className="mr-2 h-4 w-4" /> {t("Retry camera")}
        </Button>
      )}
      {photo && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={saving}
          onClick={() => {
            setPhoto(null);
            setCaptureError(false);
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" /> {t("Retake")}
        </Button>
      )}
      {!photo && !cameraOff && (
        <Button
          type="button"
          className="w-full"
          disabled={capturing || cameraStarting || cameraStatus !== "on"}
          onClick={() => void capture()}
        >
          {capturing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{" "}
          {t("Take photo")}
        </Button>
      )}
      <div className="space-y-1.5">
        <label className="block text-center text-xs text-muted-foreground">
          {t("Enter your 4-digit PIN")}
        </label>
        <Input
          aria-label={t("Enter your 4-digit PIN")}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          disabled={saving}
          placeholder="••••"
          className="h-12 text-center font-mono text-xl tracking-[0.4em]"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          className="h-11"
          disabled={!photo || pin.length !== 4 || saving}
          onClick={() => void save()}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t("Save photo")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={saving}
          onClick={onClose}
        >
          {t("Cancel")}
        </Button>
      </div>
    </div>
  );
}
