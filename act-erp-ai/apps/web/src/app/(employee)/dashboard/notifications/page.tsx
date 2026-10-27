import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { MarkAllReadButton } from "./mark-all-read-button";
import { MarkReadButton } from "./mark-read-button";
import { MarkSeenOnView } from "./mark-seen";
import {
  NotificationPagination,
  notificationPage,
  notificationPageCount,
} from "./notification-pagination";
import { getPortalLanguage } from "@/lib/portal-i18n/server";
import { localizeNotification } from "@/lib/portal-i18n/notifications";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("notifications.title") };
}

/** Only same-site paths and http(s) URLs are ever rendered as links. */
function safeHref(link: string | null): { href: string; external: boolean } | null {
  if (!link) return null;
  if (link.startsWith("/") && !link.startsWith("//"))
    return { href: link, external: false };
  try {
    const u = new URL(link);
    if (u.protocol === "https:" || u.protocol === "http:")
      return { href: u.toString(), external: true };
  } catch {
    /* ignore */
  }
  return null;
}

const PAGE_SIZE = 100;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  const translator = await getPortalLanguage();
  const { t, enumLabel, formatRelative } = translator;
  if (!user.employeeId)
    return (
      <p className="text-sm text-muted-foreground">{t("notifications.noEmployee")}</p>
    );
  const requestedPage = notificationPage((await searchParams).page);

  // These counts cover the complete inbox. Required query failures are
  // deliberately allowed to reach the route error boundary.
  const [totalCount, unreadCount] = await Promise.all([
    db.notificationRecipient.count({ where: { employeeId: user.employeeId } }),
    db.notificationRecipient.count({
      where: { employeeId: user.employeeId, read: false },
    }),
  ]);
  const totalPages = notificationPageCount(totalCount, PAGE_SIZE);
  const page = Math.min(requestedPage, totalPages);
  const items = await db.notificationRecipient.findMany({
    where: { employeeId: user.employeeId },
    include: { notification: true },
    orderBy: { notification: { createdAt: "desc" } },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  return (
    <>
      {unreadCount > 0 && <MarkSeenOnView />}
      <PageHeader
        title={t("notifications.title")}
        description={t("notifications.unreadCount", {
          unread: unreadCount,
          total: totalCount,
        })}
        actions={unreadCount > 0 && <MarkAllReadButton />}
      />
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {items.length === 0 && (
              <li className="grid h-32 place-items-center text-center text-xs text-muted-foreground">
                <div>
                  <Bell className="mx-auto mb-2 h-5 w-5" />
                  {t("notifications.empty")}
                </div>
              </li>
            )}
            {items.map((i) => {
              const n = i.notification;
              const content = localizeNotification(n, translator);
              const variant =
                n.priority === "URGENT"
                  ? "destructive"
                  : n.priority === "HIGH"
                    ? "warning"
                    : n.priority === "LOW"
                      ? "outline"
                      : "default";
              return (
                <li
                  key={i.id}
                  className={`grid grid-cols-[auto_1fr_auto] items-start gap-3 p-3 ${i.read ? "" : "bg-muted/30"}`}
                >
                  <span
                    className={`mt-1 h-2 w-2 rounded-full ${i.read ? "bg-transparent" : "bg-primary"}`}
                    aria-label={t(i.read ? "notifications.read" : "notifications.unread")}
                    role="status"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{content.title}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {enumLabel(n.type)}
                      </Badge>
                      <Badge variant={variant} className="text-[10px]">
                        {enumLabel(n.priority)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      {content.message}
                    </p>
                    {(() => {
                      const l = safeHref(n.link);
                      if (!l) return null;
                      return l.external ? (
                        <a
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-xs text-primary hover:underline"
                        >
                          {t("notifications.openLink")}
                        </a>
                      ) : (
                        <Link
                          href={l.href}
                          className="mt-1 inline-block text-xs text-primary hover:underline"
                        >
                          {t("notifications.viewDetails")}
                        </Link>
                      );
                    })()}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {formatRelative(n.createdAt)}
                    </p>
                  </div>
                  {!i.read && <MarkReadButton id={n.id} />}
                  {i.read && (
                    <span
                      aria-label={t("notifications.read")}
                      role="status"
                      className="text-[10px] text-muted-foreground"
                    >
                      <CheckCheck aria-hidden="true" className="h-3 w-3" />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      <NotificationPagination page={page} totalPages={totalPages} />
    </>
  );
}
