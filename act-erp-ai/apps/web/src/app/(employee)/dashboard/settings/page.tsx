import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { ChangePasswordForm } from "./change-password-form";
import { KioskPinForm } from "./kiosk-pin-form";
import { PersonalEmailForm } from "./personal-email-form";
import { W2ConsentForm } from "./w2-consent-form";
import { BenefitsConsentForm } from "./benefits-consent-form";
import { env } from "@/lib/env";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const employeeRow = user.employeeId
    ? await db.employee.findUnique({
        where: { id: user.employeeId },
        select: { personalEmail: true, w2ConsentAt: true, benefitsEConsentAt: true },
      })
    : null;
  const personalEmail = employeeRow?.personalEmail;
  return (
    <>
      <PageHeader title="Settings" description="Account, security, and appearance." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>{user.email ?? "(signs in with username)"}</CardDescription>
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
            <CardDescription>
              Change your password. Requires the current one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        {user.employeeId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Kiosk PIN</CardTitle>
              <CardDescription>
                Your temporary PIN is 3214. Change it here to a private 4–6 digit PIN.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <KioskPinForm />
            </CardContent>
          </Card>
        )}

        {user.employeeId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Two-factor authentication</CardTitle>
              <CardDescription>
                {env.LOGIN_2FA_ENABLED === "true"
                  ? "A 6-digit code is emailed here every time you sign in."
                  : "Email verification is temporarily paused. Your saved address is optional."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PersonalEmailForm
                current={personalEmail ?? ""}
                required={env.LOGIN_2FA_ENABLED === "true"}
              />
            </CardContent>
          </Card>
        )}

        {user.employeeId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">W-2 delivery</CardTitle>
              <CardDescription>Paper by default, unless you opt in.</CardDescription>
            </CardHeader>
            <CardContent>
              <W2ConsentForm consented={!!employeeRow?.w2ConsentAt} />
            </CardContent>
          </Card>
        )}

        {user.employeeId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Benefits document delivery</CardTitle>
              <CardDescription>Paper by default, unless you opt in.</CardDescription>
            </CardHeader>
            <CardContent>
              <BenefitsConsentForm consented={!!employeeRow?.benefitsEConsentAt} />
            </CardContent>
          </Card>
        )}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        <Link href="/privacy" target="_blank" className="hover:underline">
          Privacy notice
        </Link>{" "}
        — what we collect and why.
      </p>
    </>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b pb-2 last:border-b-0 last:pb-0">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono text-sm" : "text-sm"}>{value}</p>
    </div>
  );
}
