import { redirect } from "next/navigation";
import { getSessionUserForPasswordChange } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { ChangePasswordForm } from "@/app/(employee)/dashboard/settings/change-password-form";
import { signOut } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("auth.password.title") };
}
export const dynamic = "force-dynamic";

export default async function ForcedPasswordChangePage() {
  const { t } = await getPortalLanguage();
  // This page is the sole UI escape hatch from the forced-password gate.
  const user = await getSessionUserForPasswordChange();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) {
    redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
  }
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-end p-6">
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-4">
            <Logo priority width={180} height={72} className="h-12" />
            <div className="space-y-1 text-center">
              <h1 className="text-2xl font-bold tracking-tight">{t("auth.password.title")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("auth.password.description")}
              </p>
            </div>
          </div>
          <ChangePasswordForm />
          <form action={signOut} className="text-center">
            <Button type="submit" variant="link" size="sm" className="text-xs text-muted-foreground">
              {t("auth.password.signOut")}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
