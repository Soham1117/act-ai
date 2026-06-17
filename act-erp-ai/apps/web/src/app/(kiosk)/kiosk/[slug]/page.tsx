import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getActiveKioskSession } from "@/server/actions/kiosk";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lock, MonitorCheck } from "lucide-react";
import { KioskScreen } from "../kiosk-screen";
import { ActivateForm } from "./activate-form";

export const metadata = { title: "Kiosk" };

export default async function KioskTerminalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const kiosk = await db.kioskSession.findUnique({ where: { slug } });
  if (!kiosk) notFound();

  // 1) Active kiosk cookie matches this slug → show the terminal.
  const active = await getActiveKioskSession(slug);
  if (active) {
    return <KioskScreen slug={slug} label={active.label ?? "ACT Kiosk"} />;
  }

  // 2) Kiosk not active on this device. If an admin is logged in, offer
  // a one-click activate. Otherwise prompt them to log in.
  const user = await getSessionUser();
  const expired = kiosk.expiresAt < new Date();
  const revoked = !!kiosk.revokedAt;

  if (!user) {
    redirect(`/login?next=/kiosk/${slug}`);
  }
  if (user.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <div className="mb-3 flex items-center gap-2">
            <MonitorCheck className="h-5 w-5 text-primary" />
            <Badge
              variant={revoked ? "destructive" : expired ? "secondary" : "outline"}
              className="text-[10px]"
            >
              {revoked ? "Revoked" : expired ? "Expired" : "Inactive"}
            </Badge>
          </div>
          <CardTitle>Activate kiosk on this device</CardTitle>
          <CardDescription>
            Activating this kiosk binds the cookie on this browser to{" "}
            <span className="font-mono text-xs">{kiosk.label ?? slug}</span>{" "}
            for the next 90 days. Anyone with physical access to this terminal
            will be able to clock employees in/out by ID.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {revoked && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              This kiosk was revoked. Activating again will create a new
              session.
            </div>
          )}
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Lock className="h-3 w-3" /> Signed in as
            </div>
            <p className="mt-1 font-medium">{user.email}</p>
          </div>
          <ActivateForm slug={slug} />
          <Button asChild variant="ghost" className="w-full text-xs" size="sm">
            <Link href="/kiosk">Cancel</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
