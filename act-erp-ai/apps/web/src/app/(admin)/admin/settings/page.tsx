import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Activity, ArrowRight, LayoutGrid, Monitor, Shield } from "lucide-react";
import { ChangePasswordForm } from "@/app/(employee)/dashboard/settings/change-password-form";

export const metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  const user = await requireAdmin();

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [employeeCount, kioskCount, auditCount, recentAudit] = await Promise.all([
    safe(db.employee.count(), 0),
    safe(db.kioskSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }), 0),
    safe(db.auditLog.count(), 0),
    safe(
      db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
      [],
    ),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Workspace administration." />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Employees" value={employeeCount} />
        <StatCard label="Active kiosks" value={kioskCount} icon={<Monitor className="h-4 w-4" />} />
        <StatCard label="Audit events" value={auditCount} icon={<Activity className="h-4 w-4" />} />
        <StatCard label="Your role" value={user.role === "ADMIN" ? "Admin" : "Employee"} icon={<Shield className="h-4 w-4 text-primary" />} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Name" value={user.name} />
            <Row label="Role" value={user.role === "ADMIN" ? "Admin" : "Employee"} />
            <Row label="Employee ID" value={user.employeeId ?? "—"} mono />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Appearance</CardTitle>
            <CardDescription>Light / dark / system.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-sm">Theme</p>
              <ThemeToggle />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Manage</CardTitle>
            <CardDescription>Workspace controls.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <SettingsLink href="/admin/kiosks" icon={<LayoutGrid className="h-3.5 w-3.5" />} label="Kiosks" />
            <SettingsLink href="/admin/onboarding" icon={<Shield className="h-3.5 w-3.5" />} label="Onboarding invites" />
            <SettingsLink href="/admin/job-codes" icon={<Activity className="h-3.5 w-3.5" />} label="Job codes" />
            <SettingsLink href="/admin/departments" icon={<Activity className="h-3.5 w-3.5" />} label="Departments" />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Recent audit events</CardTitle>
          <CardDescription>Last 8 actions across the workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentAudit.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No events yet.</p>
          ) : (
            <ul className="divide-y">
              {recentAudit.map((a) => (
                <li key={a.id} className="grid grid-cols-[1fr_auto] items-center gap-4 py-2 text-xs">
                  <span>
                    <span className="font-mono text-[10px] text-muted-foreground">{a.action}</span>
                    {" "}
                    <span className="text-muted-foreground">·</span>
                    {" "}
                    <span>{a.actorEmail ?? "system"}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {a.createdAt.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b pb-2 last:border-b-0 last:pb-0">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono text-sm" : "text-sm"}>{value}</p>
    </div>
  );
}

function SettingsLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
    </Link>
  );
}
