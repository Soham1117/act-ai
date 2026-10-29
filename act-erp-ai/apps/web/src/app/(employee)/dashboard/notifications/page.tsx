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
import { ResponsiveDataList } from "@/components/mobile";

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
          {items.length === 0 ? (
            <p className="grid h-32 place-items-center text-center text-xs text-muted-foreground">
              <span>
                <Bell className="mx-auto mb-2 h-5 w-5" />
                {t("notifications.empty")}
              </span>
            </p>
          ) : (
            <ResponsiveDataList
              mobile={
                <ul className="divide-y">
                  {items.map((i) => (
                    <NotificationItem
                      key={i.id}
                      i={i}
                      layout="mobile"
                      t={t}
                      enumLabel={enumLabel}
                      formatRelative={formatRelative}
                      translator={translator}
                    />
                  ))}
                </ul>
              }
              desktop={
                <ul className="divide-y">
                  {items.map((i) => (
                    <NotificationItem
                      key={i.id}
                      i={i}
                      layout="desktop"
                      t={t}
                      enumLabel={enumLabel}
                      formatRelative={formatRelative}
                      translator={translator}
                    />
                  ))}
                </ul>
              }
            />
          )}
        </CardContent>
      </Card>
      <NotificationPagination page={page} totalPages={totalPages} />
    </>
  );
}

type NotificationRow = {
  id: string;
  read: boolean;
  notification: {
    id: string;
    type: string;
    priority: string;
    link: string | null;
    createdAt: Date;
    title: string;
    message: string;
  };
};

function NotificationItem({
  i,
  layout,
  t,
  enumLabel,
  formatRelative,
  translator,
}: {
  i: NotificationRow;
  layout: "mobile" | "desktop";
  t: (key: string, params?: Record<string, string | number>) => string;
  enumLabel: (code: string) => string;
  formatRelative: (value: Date | string) => string;
  translator: Awaited<ReturnType<typeof getPortalLanguage>>;
}) {
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
  const linkNode = (() => {
    const l = safeHref(n.link);
    if (!l) return null;
    return l.external ? (
      <a
        href={l.href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block min-h-10 py-2 text-xs text-primary hover:underline"
      >
        {t("notifications.openLink")}
      </a>
    ) : (
      <Link
        href={l.href}
        className="mt-1 inline-block min-h-10 py-2 text-xs text-primary hover:underline"
      >
        {t("notifications.viewDetails")}
      </Link>
    );
  })();
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 break-words text-sm font-medium">{content.title}</p>
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
      {linkNode}
      <p className="mt-1 text-[10px] text-muted-foreground">
        {formatRelative(n.createdAt)}
      </p>
    </>
  );
  const unreadDot = (
    <span
      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.read ? "bg-transparent" : "bg-primary"}`}
      aria-label={t(i.read ? "notifications.read" : "notifications.unread")}
      role="status"
    />
  );
  const readAction = !i.read ? (
    <MarkReadButton id={n.id} />
  ) : (
    <span
      aria-label={t("notifications.read")}
      role="status"
      className="text-[10px] text-muted-foreground"
    >
      <CheckCheck aria-hidden="true" className="h-3 w-3" />
    </span>
  );

  if (layout === "mobile") {
    return (
      <li className={`space-y-2 p-3 ${i.read ? "" : "bg-muted/30"}`}>
        <div className="flex gap-3">
          {unreadDot}
          <div className="min-w-0 flex-1">{body}</div>
        </div>
        <div className="flex justify-end pl-5">{readAction}</div>
      </li>
    );
  }

  return (
    <li
      className={`grid grid-cols-[auto_1fr_auto] items-start gap-3 p-3 ${i.read ? "" : "bg-muted/30"}`}
    >
      {unreadDot}
      <div className="min-w-0">{body}</div>
      {readAction}
    </li>
  );
}
