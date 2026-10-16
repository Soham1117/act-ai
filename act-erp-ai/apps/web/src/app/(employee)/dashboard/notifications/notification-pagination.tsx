// No "use client": the page (a server component) calls notificationPage() and
// notificationPageCount() below, which is not allowed on client-module exports.
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function notificationPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function notificationPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function notificationPageHref(page: number): string {
  return page <= 1 ? "/dashboard/notifications" : `/dashboard/notifications?page=${page}`;
}

export function NotificationPagination({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-3 flex items-center justify-between text-xs text-muted-foreground" aria-label="Notification pages">
      <span>Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        {page > 1 && (
          <Button asChild size="sm" variant="outline">
            <Link href={notificationPageHref(page - 1)}>Previous</Link>
          </Button>
        )}
        {page < totalPages && (
          <Button asChild size="sm" variant="outline">
            <Link href={notificationPageHref(page + 1)}>Next</Link>
          </Button>
        )}
      </div>
    </nav>
  );
}
