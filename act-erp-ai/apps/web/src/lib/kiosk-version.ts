/** Pure helpers for the kiosk version watcher. No React, no DOM access except where noted. */

export const VERSION_POLL_MS = 60_000;
export const IDLE_RECHECK_MS = 5_000;
export const IDLE_REQUIRED_MS = 15_000;
export const RELOAD_GUARD_MS = 30_000;
export const RELOAD_STORAGE_KEY = "kiosk-last-auto-reload";

/** True when the server build differs from this bundle's build. Empty ids never count. */
export function isNewBuild(serverId: unknown, clientId: string | undefined): boolean {
  return typeof serverId === "string" && serverId !== "" && !!clientId && serverId !== clientId;
}

/** Idle = no input for `requiredMs`, nothing busy (confirm card or punch in flight). */
export function isIdle(args: {
  now: number;
  lastActivity: number;
  busy: boolean;
  requiredMs?: number;
}): boolean {
  return !args.busy && args.now - args.lastActivity >= (args.requiredMs ?? IDLE_REQUIRED_MS);
}

const STALE_PATTERNS = [
  /Failed to find Server Action/i,
  /was not found on the server/i,
  /older or newer deployment/i,
];

/** Matches the errors Next throws when the page's server action ids are from another deployment. */
export function isStaleActionError(err: unknown): boolean {
  const msg =
    typeof err === "string" ? err : err instanceof Error ? err.message : (err as { message?: unknown })?.message;
  return typeof msg === "string" && STALE_PATTERNS.some((p) => p.test(msg));
}

/** Loop guard: allow an auto reload only if the last one was at least `guardMs` ago. */
export function canAutoReload(lastReload: number | null, now: number, guardMs = RELOAD_GUARD_MS): boolean {
  if (lastReload === null || !Number.isFinite(lastReload)) return true;
  return now - lastReload >= guardMs || now < lastReload;
}

// --- Busy flag (browser only) -------------------------------------------------
// Several components can be busy at once, so each uses its own source name.
const busySources = new Set<string>();

/** Set or clear a busy source; mirrors the state on `document.body[data-kiosk-busy]`. */
export function setKioskBusy(source: string, busy: boolean): void {
  if (busy) busySources.add(source);
  else busySources.delete(source);
  if (typeof document === "undefined") return;
  if (busySources.size > 0) document.body.setAttribute("data-kiosk-busy", "1");
  else document.body.removeAttribute("data-kiosk-busy");
}

export function isKioskBusy(): boolean {
  return busySources.size > 0;
}
