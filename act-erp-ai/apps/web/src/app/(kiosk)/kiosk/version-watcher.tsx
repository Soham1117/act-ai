"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import {
  IDLE_RECHECK_MS,
  RELOAD_STORAGE_KEY,
  VERSION_POLL_MS,
  canAutoReload,
  isIdle,
  isKioskBusy,
  isNewBuild,
  isStaleActionError,
} from "@/lib/kiosk-version";

const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID;

/** Reload unless we already auto-reloaded in the last 30 s (stops reload loops). */
function guardedReload(): boolean {
  let last: number | null = null;
  try {
    const raw = sessionStorage.getItem(RELOAD_STORAGE_KEY);
    last = raw ? Number(raw) : null;
  } catch {
    // sessionStorage can be blocked; fall through and allow.
  }
  const now = Date.now();
  if (!canAutoReload(last, now)) return false;
  try {
    sessionStorage.setItem(RELOAD_STORAGE_KEY, String(now));
  } catch {
    // ignore
  }
  window.location.reload();
  return true;
}

/**
 * Keeps an always-open kiosk page on the current deployment.
 * 1. Polls /api/version; when the build id changed, reloads once the kiosk is idle.
 * 2. Safety net: if a server action fails because it is from another deployment,
 *    shows a toast and reloads.
 * Renders nothing.
 */
export function VersionWatcher() {
  useEffect(() => {
    let lastActivity = Date.now();
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let staleHandled = false;

    const onActivity = () => {
      lastActivity = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });

    const waitForIdleThenReload = () => {
      if (idleTimer) return; // already waiting
      const tick = () => {
        idleTimer = null;
        if (isIdle({ now: Date.now(), lastActivity, busy: isKioskBusy() })) {
          if (!guardedReload()) idleTimer = setTimeout(tick, IDLE_RECHECK_MS);
        } else {
          idleTimer = setTimeout(tick, IDLE_RECHECK_MS);
        }
      };
      tick();
    };

    const checkVersion = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: unknown };
        if (isNewBuild(data.buildId, CLIENT_BUILD_ID)) waitForIdleThenReload();
      } catch {
        // Server may be restarting during a deploy. Try again next time.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(() => void checkVersion(), VERSION_POLL_MS);

    const onStale = (err: unknown) => {
      if (staleHandled || !isStaleActionError(err)) return;
      staleHandled = true;
      toast.error("The kiosk was updated. Reloading…");
      setTimeout(() => {
        // If the guard blocks the reload, allow a new attempt later.
        if (!guardedReload()) staleHandled = false;
      }, 1500);
    };
    const onRejection = (e: PromiseRejectionEvent) => onStale(e.reason);
    const onError = (e: ErrorEvent) => onStale(e.error ?? e.message);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);

    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
      clearInterval(poll);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, []);

  return null;
}
