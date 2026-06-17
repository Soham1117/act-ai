import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, MonitorSmartphone } from "lucide-react";

export const metadata = { title: "Kiosks" };

/**
 * The /kiosk index is admin-only — it lists every deployed kiosk and lets
 * the admin jump to one to activate it on this terminal. Employees never
 * land here directly; they go to /kiosk/[slug].
 */
export default async function KioskIndex() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/kiosk");
  if (user.role !== "ADMIN") redirect("/unauthorized");

  const kiosks = await db.kioskSession
    .findMany({ orderBy: { createdAt: "desc" } })
    .catch(() => []);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Kiosks</h1>
        <p className="text-sm text-muted-foreground">
          Pick a kiosk to activate on this terminal, or create a new one.
        </p>
      </div>

      <div className="mb-6 flex justify-end">
        <Button asChild>
          <Link href="/admin/kiosks">Manage kiosks</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deployed kiosks</CardTitle>
          <CardDescription>
            Click a kiosk to open its terminal. From there, an admin can
            activate it on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {kiosks.length === 0 ? (
            <div className="grid h-32 place-items-center text-xs text-muted-foreground">
              No kiosks yet — create one from{" "}
              <Link href="/admin/kiosks" className="ml-1 text-primary underline">
                Admin → Kiosks
              </Link>
              .
            </div>
          ) : (
            <ul className="divide-y">
              {kiosks.map((k) => {
                const expired = k.expiresAt < new Date();
                const revoked = !!k.revokedAt;
                const active = !expired && !revoked && !!k.cookieHash;
                return (
                  <li
                    key={k.id}
                    className="flex items-center justify-between gap-3 p-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
                        <p className="truncate font-medium">
                          {k.label ?? "Unnamed"}
                        </p>
                        <Badge
                          variant={
                            active
                              ? "default"
                              : revoked
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {revoked
                            ? "Revoked"
                            : expired
                            ? "Expired"
                            : active
                            ? "Active"
                            : "Inactive"}
                        </Badge>
                      </div>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        /kiosk/{k.slug ?? "—"}
                      </p>
                    </div>
                    {k.slug && (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/kiosk/${k.slug}`}>
                          Open <ArrowRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
