"use client";

import { toast } from "sonner";
import {
  type ActionFail,
  type ActionOk,
  type ActionResult,
  failFromUnknown,
  humanizeUnexpectedError,
  isDigestErrorMessage,
} from "@/lib/action-result";

const DEFAULT_FALLBACK =
  "Something went wrong. Try again, or contact an admin if it keeps happening.";

/** Show a toast for a failed ActionResult. Returns true when ok. */
export function toastAction<T extends Record<string, unknown>>(
  result: ActionResult<T>,
  fallback = DEFAULT_FALLBACK,
): result is ActionOk<T> {
  if (result.ok) return true;
  toast.error(result.error || fallback);
  return false;
}

/**
 * For legacy try/catch around actions that still throw, or unexpected
 * failures. Never shows the Next.js production digest blob.
 */
export function toastCaught(err: unknown, fallback = DEFAULT_FALLBACK): void {
  if (err instanceof Error && isDigestErrorMessage(err.message)) {
    toast.error(fallback);
    return;
  }
  toast.error(humanizeUnexpectedError(err) ?? fallback);
}

/**
 * Await a server action call. If the call throws (connection drop, server
 * crash, stale deploy) the error is turned into a plain `{ ok: false, error }`
 * result, so the usual `toastAction(res)` check shows the toast and the caller
 * keeps its dialog and typed values instead of the error boundary taking over.
 *
 *   const res = await runAction(() => someAction(input));
 *   if (!toastAction(res)) return;
 */
export async function runAction<T extends { ok: boolean }>(
  call: () => Promise<T>,
  fallback?: string,
): Promise<T | ActionFail> {
  try {
    return await call();
  } catch (err) {
    return failFromUnknown(err, fallback);
  }
}
