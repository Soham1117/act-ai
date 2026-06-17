import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

export const metadata = { title: "Activity" };

const PAGE_SIZE = 200;

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; action?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const actionFilter = sp.action?.trim() ?? "";

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const items = await safe(
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      where: {
        AND: [
          q
            ? {
                OR: [
                  { actorEmail: { contains: q, mode: "insensitive" } },
                  { resource: { contains: q, mode: "insensitive" } },
                  { action: { contains: q, mode: "insensitive" } },
                ],
              }
            : {},
          actionFilter ? { action: { startsWith: actionFilter } } : {},
        ],
      },
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
          <option value="kiosk.">Kiosk</option>
          <option value="employee.">Employee</option>
          <option value="leave.">Leave</option>
          <option value="reimbursement.">Reimbursement</option>
          <option value="document.">Document</option>
          <option value="onboarding.">Onboarding</option>
        </select>
        <button
          type="submit"
          className="h-9 rounded-md border bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Filter
        </button>
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

      {items.length === PAGE_SIZE && (
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Showing the latest {PAGE_SIZE} entries. Refine the search to find older activity.
        </p>
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
