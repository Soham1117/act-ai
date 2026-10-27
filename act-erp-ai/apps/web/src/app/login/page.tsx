import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";
import { env } from "@/lib/env";
import { LoginForm } from "./login-form";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("auth.login.title") };
}

type SearchParams = Promise<{ next?: string; error?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { t } = await getPortalLanguage();
  const user = await getSessionUser();
  if (user) {
    redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
  }
  const { next, error } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-end p-6">
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex flex-col items-center gap-4">
            <Logo priority width={180} height={72} className="h-12" />
            <div className="space-y-1 text-center">
              <h1 className="text-2xl font-bold tracking-tight">{t("auth.login.welcome")}</h1>
              <p className="text-sm text-muted-foreground">
                {env.LOGIN_2FA_ENABLED === "true"
                  ? t("auth.login.twoFactorDescription")
                  : t("auth.login.description")}
              </p>
            </div>
          </div>
          <LoginForm next={next} initialError={error} />
          <p className="text-center text-xs text-muted-foreground">
            {t("auth.login.newHire")} {" "}
            <Link href="/onboard" className="text-primary hover:underline">
              {t("auth.login.onboardingLink")}
            </Link>
            .
          </p>
        </div>
      </main>
      <footer className="space-y-1 p-6 text-center text-[11px] text-muted-foreground">
        <p>
          <Link href="/privacy" className="hover:underline">
            {t("auth.login.privacyNotice")}
          </Link>
        </p>
        <p>© {new Date().getFullYear()} American Completion Tools</p>
      </footer>
    </div>
  );
}
