import Link from "next/link";
import { Brand } from "@/components/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("auth.onboard.title") };
}

export default async function OnboardLandingPage() {
  const { t } = await getPortalLanguage();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-6">
        <Brand href="/" />
      </header>
      <main className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{t("auth.onboard.title")}</CardTitle>
            <CardDescription>
              {t("auth.onboard.inviteRequired")}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              {t("auth.onboard.existingLink")} {" "}
              <code className="text-xs">/onboard/&lt;token&gt;</code>.
            </p>
            <p className="mt-3">
              {t("auth.onboard.existingEmployee")} {" "}
              <Link href="/login" className="text-primary hover:underline">
                {t("auth.onboard.signInHere")}
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
