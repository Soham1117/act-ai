import { db } from "@/lib/db";
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

  const [items, departments] = await Promise.all([
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

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Broadcast announcements, policy updates, and payroll alerts."
        actions={<BroadcastDialog departments={departments} />}
      />

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">All ({items.length})</TabsTrigger>
        </TabsList>
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
