import Link from "next/link";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { MarkSeenOnView } from "@/app/(employee)/dashboard/notifications/mark-seen";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BroadcastDialog } from "./broadcast-dialog";
import { formatDistanceToNow } from "date-fns";

export const metadata = { title: "Notifications" };

export default async function AdminNotificationsPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  // The bell badge counts the admin's OWN unread notifications, so the bell
  // must lead to them (this page used to show only broadcasts sent).
  const me = await getSessionUser();
  const [inbox, items, departments] = await Promise.all([
    me?.employeeId
      ? safe(
          db.notificationRecipient.findMany({
            where: { employeeId: me.employeeId },
            include: { notification: true },
            orderBy: { notification: { createdAt: "desc" } },
            take: 50,
          }),
          [],
        )
      : Promise.resolve([]),
    safe(
      db.notification.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { _count: { select: { recipients: true } } },
      }),
      [],
    ),
    safe(
      db.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      [],
    ),
  ]);

  const unread = inbox.filter((i) => !i.read).length;

  return (
    <>
      {unread > 0 && <MarkSeenOnView />}
      <PageHeader
        title="Notifications"
        description="Your notifications, plus broadcast announcements and payroll alerts you sent."
        actions={<BroadcastDialog departments={departments} />}
      />

      <Tabs defaultValue={me?.employeeId ? "inbox" : "all"} className="space-y-4">
        <TabsList>
          {me?.employeeId && <TabsTrigger value="inbox">My inbox ({inbox.length})</TabsTrigger>}
          <TabsTrigger value="all">Sent ({items.length})</TabsTrigger>
        </TabsList>
        {me?.employeeId && (
          <TabsContent value="inbox">
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {inbox.length === 0 && (
                    <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                      No notifications yet.
                    </li>
                  )}
                  {inbox.map((i) => (
                    <li key={i.id} className={`space-y-1 p-3 ${i.read ? "" : "bg-muted/30"}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{i.notification.title}</p>
                        <Badge variant="outline" className="text-[10px]">{i.notification.type}</Badge>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {formatDistanceToNow(i.notification.createdAt, { addSuffix: true })}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {i.notification.message}
                      </p>
                      {i.notification.link?.startsWith("/") && !i.notification.link.startsWith("//") && (
                        <Link href={i.notification.link} className="text-xs text-primary hover:underline">
                          View details
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        )}
        <TabsContent value="all">
          <Card>
            <CardHeader><CardTitle className="text-base">Sent</CardTitle></CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {items.length === 0 && (
                  <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                    No notifications sent yet.
                  </li>
                )}
                {items.map((n) => {
                  const variant =
                    n.priority === "URGENT" ? "destructive" :
                    n.priority === "HIGH" ? "warning" :
                    n.priority === "LOW" ? "outline" : "default";
                  return (
                    <li key={n.id} className="space-y-1 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{n.title}</p>
                        <Badge variant="outline" className="text-[10px]">{n.type}</Badge>
                        <Badge variant={variant} className="text-[10px]">{n.priority}</Badge>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {formatDistanceToNow(n.createdAt, { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Delivered to {n._count.recipients} recipients
                      </p>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
