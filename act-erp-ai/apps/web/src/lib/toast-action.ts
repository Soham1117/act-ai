"use client";

import { toast } from "sonner";
import {
  type ActionOk,
  type ActionResult,
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
