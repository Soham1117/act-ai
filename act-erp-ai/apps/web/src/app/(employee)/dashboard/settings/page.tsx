import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Settings" description="Account, security, and appearance." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
              <div>
                <p className="text-sm">Theme</p>
                <p className="text-xs text-muted-foreground">Default is dark.</p>
              </div>
              <ThemeToggle />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Password</CardTitle>
            <CardDescription>Change your password. Requires the current one.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Two-factor authentication</CardTitle>
            <CardDescription>
              Available in a future release.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              When enabled, you&apos;ll be prompted for a TOTP code from your
              authenticator app on each login.
            </p>
          </CardContent>
        </Card>
      </div>
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
