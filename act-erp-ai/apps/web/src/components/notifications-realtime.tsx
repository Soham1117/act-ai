"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

/**
 * Live-ish unread badge. Polls /api/notifications/unread every 30s (replaced
 * Supabase Realtime in Phase 3b). Mount once in the topbar; pass the seeded
 * server count so the badge is accurate before the first poll.
 */
export function NotificationsRealtime({
  employeeId,
  initialUnread,
}: {
  employeeId: string | null;
  initialUnread: number;
}) {
  const [unread, setUnread] = useState(initialUnread);

  useEffect(() => {
    if (!employeeId) return;
    let active = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (active) setUnread(d.unread ?? 0);
      } catch {
        /* transient — keep last count */
      }
    };
    const id = setInterval(poll, 30000);
    poll();
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [employeeId]);

  if (unread <= 0) return null;
  return (
    <Badge
      variant="default"
      className="ml-auto h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px] tabular-nums"
    >
      {unread > 99 ? "99+" : unread}
    </Badge>
  );
}
