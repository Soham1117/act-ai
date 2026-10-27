"use client";

import { useEffect } from "react";
import { markAllNotificationsRead } from "@/server/actions/notifications";
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notification-events";

/**
 * Opening the inbox counts as seeing it: mark everything read once on mount
 * and tell the bell badge to refetch. Failures are ignored on purpose (the
 * badge just stays until the next successful visit or "Mark all read").
 */
export function MarkSeenOnView() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await markAllNotificationsRead();
        if (!cancelled && res.ok)
          window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
      } catch {
        /* best effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
