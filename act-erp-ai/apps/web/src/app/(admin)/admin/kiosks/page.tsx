import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { CreateKioskDialog } from "./create-kiosk-dialog";
import { KioskRowActions } from "./kiosk-row-actions";

export const metadata = { title: "Kiosks" };

export default async function KiosksPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const sessions = await safe(
    db.kioskSession.findMany({ orderBy: { createdAt: "desc" } }),
    [],
  );

  // Per-kiosk usage stats from TimeEntry.kioskSlug.
  const counts = await safe(
    db.timeEntry.groupBy({
      by: ["kioskSlug"],
      _count: true,
      where: { kioskSlug: { not: null } },
    }),
    [],
  );
  const usageBySlug = Object.fromEntries(
    counts.map((c) => [c.kioskSlug, c._count]),
  ) as Record<string, number>;

  return (
    <>
      <PageHeader
        title="Kiosks"
        description="Each kiosk is a permanent terminal endpoint. Create here, activate from the device."
        actions={<CreateKioskDialog />}
      />
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {sessions.length === 0 && (
              <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                No kiosks yet. Click <span className="mx-1 font-medium">New kiosk</span>{" "}
                to create one.
              </li>
            )}
            {sessions.map((s) => {
              const expired = s.expiresAt < new Date();
              const revoked = !!s.revokedAt;
              const active = !expired && !revoked && !!s.cookieHash;
              const status = revoked
                ? "Revoked"
                : expired
                ? "Expired"
                : active
                ? "Active"
                : "Inactive";
              const used = (s.slug && usageBySlug[s.slug]) || 0;
              return (
                <li
                  key={s.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 p-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">
                        {s.label ?? "Unnamed kiosk"}
                      </p>
                      <Badge
                        variant={
                          status === "Active"
                            ? "default"
                            : status === "Revoked"
                            ? "destructive"
                            : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {status}
                      </Badge>
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      /kiosk/{s.slug ?? "—"} · {used} clock event
                      {used === 1 ? "" : "s"} recorded
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Created {s.createdAt.toLocaleDateString()}
                      {s.lastUsedAt && ` · last used ${s.lastUsedAt.toLocaleDateString()}`}
                      {!revoked && ` · expires ${s.expiresAt.toLocaleDateString()}`}
                    </p>
                  </div>
                  {s.slug && (
                    <Link
                      href={`/kiosk/${s.slug}`}
                      target="_blank"
                      className="text-[11px] text-primary hover:underline"
                    >
                      Open <ExternalLink className="ml-0.5 inline h-3 w-3" />
                    </Link>
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {s.id.slice(0, 8)}…
                  </span>
                  <KioskRowActions id={s.id} slug={s.slug} isActive={active} />
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
