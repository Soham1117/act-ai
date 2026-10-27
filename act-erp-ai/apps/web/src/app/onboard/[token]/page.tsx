import { notFound } from "next/navigation";
import { Brand } from "@/components/brand";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { OnboardingForm } from "./onboarding-form";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("auth.onboard.completeTitle") };
}

export default async function OnboardTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { t, formatDate, formatDateOnly } = await getPortalLanguage();
  const { token } = await params;

  const invite = await db.onboardingInvite.findUnique({ where: { token } });
  if (!invite) notFound();

  const expired = invite.status === "EXPIRED" || invite.expiresAt < new Date();
  const completed = invite.status === "COMPLETED";

  // Terms set by the admin on the invite. Shown for information only; the
  // new hire can't change them and the server ignores anything they send.
  const closed = completed || expired;
  const department = !closed && invite.departmentId
    ? await db.department.findUnique({
        where: { id: invite.departmentId },
        select: { name: true },
      })
    : null;
  const terms = [
    invite.jobTitle ? t("auth.onboard.roleTerm", { value: invite.jobTitle }) : null,
    department ? t("auth.onboard.departmentTerm", { value: department.name }) : null,
    invite.dateOfHire
      ? t("auth.onboard.startDateTerm", { value: formatDateOnly(invite.dateOfHire) })
      : null,
  ].filter(Boolean) as string[];

  // One layout for every state, so the form keeps its own state when a successful
  // submit refreshes this page (the invite is then COMPLETED): the client still shows
  // "Thanks, you're all set" instead of being replaced by the generic card.
  return (
    <div className="flex min-h-screen flex-col">
      <header className="p-6">
        <Brand href="/" />
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-3xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("auth.onboard.welcome")}</CardTitle>
              {closed && (
                <Badge variant={completed ? "success" : "destructive"}>
                  {completed ? t("auth.onboard.completed") : t("auth.onboard.expired")}
                </Badge>
              )}
            </div>
            <CardDescription>
              {completed
                ? t("auth.onboard.accountCreated")
                : expired
                  ? t("auth.onboard.inviteExpired")
                  : t("auth.onboard.description", { date: formatDate(invite.expiresAt) })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {terms.length > 0 && (
              <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">{t("auth.onboard.position")}</p>
                <p>{terms.join(" · ")}</p>
                <p className="mt-1">
                  {t("auth.onboard.adminSetsTerms")}
                </p>
              </div>
            )}
            <OnboardingForm
              token={token}
              suggestedEmail={invite.email ?? ""}
              status={completed ? "completed" : expired ? "expired" : "open"}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
