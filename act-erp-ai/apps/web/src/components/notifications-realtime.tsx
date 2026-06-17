"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";

/**
 * Listens for new NotificationRecipient rows for the current employee
 * via Supabase Realtime. Shows a toast on receive + keeps a live unread
 * count badge.
 *
 * Mount once in the topbar/layout. Pass the seeded initial count from the
 * server so the badge is accurate before the first realtime tick.
 */
export function NotificationsRealtime({
  employeeId,
  initialUnread,
}: {
  employeeId: string | null;
  initialUnread: number;
}) {
  const [unread, setUnread] = useState(initialUnread);
  const router = useRouter();

  useEffect(() => {
    if (!employeeId) return;
    const supabase = createClient();

    // Subscribe to: new recipient rows for this employee (broadcasts they
    // just received) AND updates that flip read=true (so the badge ticks
    // down when they mark something read elsewhere).
    const channel = supabase
      .channel(`notifications-${employeeId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notification_recipients",
          filter: `employee_id=eq.${employeeId}`,
        },
        () => {
          setUnread((u) => u + 1);
          toast("New notification", {
            description: "Open your notifications inbox to read it.",
            icon: <Bell className="h-4 w-4 text-primary" />,
            action: {
              label: "Open",
              onClick: () => router.push("/dashboard/notifications"),
            },
          });
          // Refresh server data so cards/lists pick it up.
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notification_recipients",
          filter: `employee_id=eq.${employeeId}`,
        },
        (payload) => {
          // If a previously-unread row was just marked read, decrement.
          const oldRow = payload.old as { read?: boolean };
          const newRow = payload.new as { read?: boolean };
          if (oldRow?.read === false && newRow?.read === true) {
            setUnread((u) => Math.max(0, u - 1));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [employeeId, router]);

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
