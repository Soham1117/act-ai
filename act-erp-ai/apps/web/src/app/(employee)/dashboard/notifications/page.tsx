import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { MarkAllReadButton } from "./mark-all-read-button";
import { MarkReadButton } from "./mark-read-button";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  if (!user.employeeId) return <p className="text-sm text-muted-foreground">No employee record.</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const items = await safe(
    db.notificationRecipient.findMany({
      where: { employeeId: user.employeeId },
      include: { notification: true },
      orderBy: { notification: { createdAt: "desc" } },
      take: 100,
    }),
    [],
  );

  const unreadCount = items.filter((i) => !i.read).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={`${unreadCount} unread of ${items.length}`}
        actions={unreadCount > 0 && <MarkAllReadButton />}
      />
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {items.length === 0 && (
              <li className="grid h-32 place-items-center text-center text-xs text-muted-foreground">
                <div>
                  <Bell className="mx-auto mb-2 h-5 w-5" />
                  No notifications yet.
                </div>
              </li>
            )}
            {items.map((i) => {
              const n = i.notification;
              const variant =
                n.priority === "URGENT" ? "destructive" :
                n.priority === "HIGH" ? "warning" :
                n.priority === "LOW" ? "outline" : "default";
              return (
                <li
                  key={i.id}
                  className={`grid grid-cols-[auto_1fr_auto] items-start gap-3 p-3 ${i.read ? "" : "bg-muted/30"}`}
                >
                  <span
                    className={`mt-1 h-2 w-2 rounded-full ${i.read ? "bg-transparent" : "bg-primary"}`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{n.title}</p>
                      <Badge variant="outline" className="text-[10px]">{n.type}</Badge>
                      <Badge variant={variant} className="text-[10px]">{n.priority}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.message}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {formatDistanceToNow(n.createdAt, { addSuffix: true })}
                    </p>
                  </div>
                  {!i.read && <MarkReadButton id={n.id} />}
                  {i.read && (
                    <span className="text-[10px] text-muted-foreground">
                      <CheckCheck className="h-3 w-3" />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
