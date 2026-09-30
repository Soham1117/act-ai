import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { Download } from "lucide-react";
import { activityPrefixes, activityWhere, prefixLabel } from "@/server/queries/activity";

export const metadata = { title: "Activity" };

const PAGE_SIZE = 100;

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; action?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const actionFilter = sp.action?.trim() ?? "";
  const requestedPage = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch (e) { console.error("[activity] query failed", e); return fallback; }
  };

  const where = activityWhere(q, actionFilter);
  const [total, prefixes] = await Promise.all([
    safe(db.auditLog.count({ where }), 0),
    activityPrefixes(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pages);

  const items = await safe(
    db.auditLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      where,
      select: {
        id: true,
        action: true,
        resource: true,
        actorEmail: true,
        diff: true,
        ip: true,
        createdAt: true,
      },
    }),
    [],
  );

  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (actionFilter) params.set("action", actionFilter);
    if (p > 1) params.set("page", String(p));
    const str = params.toString();
    return `/admin/activity${str ? `?${str}` : ""}`;
  };
  const exportHref = (() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (actionFilter) params.set("action", actionFilter);
    const str = params.toString();
    return `/admin/activity/export${str ? `?${str}` : ""}`;
  })();
  // Keep a filter chosen via URL selectable even if no rows use it any more.
  const options = prefixes.some((p) => p.value === actionFilter) || !actionFilter
    ? prefixes
    : [...prefixes, { value: actionFilter, label: prefixLabel(actionFilter) }];

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every audited action — who, what, and when."
      />

      <form className="mb-4 flex flex-wrap gap-2" action="/admin/activity">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by user, resource, or action…"
          className="h-9 flex-1 min-w-[200px] rounded-md border bg-background px-3 text-sm"
        />
        <select
          name="action"
          defaultValue={actionFilter}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">All actions</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 rounded-md border bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Filter
        </button>
        <a
          href={exportHref}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted"
        >
          <Download className="h-4 w-4" /> Export CSV
        </a>
      </form>

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="grid h-32 place-items-center text-xs text-muted-foreground">
              No activity yet.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((a) => {
                const diff = (a.diff ?? null) as Record<string, unknown> | null;
                const detail = describeDiff(diff);
                return (
                  <li key={a.id} className="grid grid-cols-[1fr_auto] items-start gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium truncate">{a.actorEmail ?? "system"}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {a.action}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground truncate">{a.resource}</span>
                      </div>
                      {detail && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
                      )}
                    </div>
                    <span
                      className="whitespace-nowrap text-[11px] text-muted-foreground"
                      title={a.createdAt.toLocaleString()}
                    >
                      {formatDistanceToNow(a.createdAt, { addSuffix: true })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {pages > 1 && (
        <nav className="mt-3 flex items-center justify-between text-xs" aria-label="Pagination">
          {page > 1 ? (
            <Link href={qs(page - 1)} className="underline">
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {page} of {pages} · {total} entries
          </span>
          {page < pages ? (
            <Link href={qs(page + 1)} className="underline">
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}

function describeDiff(diff: Record<string, unknown> | null): string | null {
  if (!diff) return null;
  const parts: string[] = [];
  if (typeof diff.employeeName === "string") parts.push(diff.employeeName);
  if (typeof diff.kioskLabel === "string") parts.push(`@ ${diff.kioskLabel}`);
  if (typeof diff.title === "string") parts.push(`"${diff.title}"`);
  if (typeof diff.name === "string" && parts.length === 0) parts.push(diff.name);
  return parts.length ? parts.join(" · ") : null;
}
