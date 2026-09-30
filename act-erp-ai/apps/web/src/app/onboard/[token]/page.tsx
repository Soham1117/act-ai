import Link from "next/link";
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
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Complete onboarding" };

export default async function OnboardTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invite = await db.onboardingInvite.findUnique({ where: { token } });
  if (!invite) notFound();

  const expired = invite.status === "EXPIRED" || invite.expiresAt < new Date();
  const completed = invite.status === "COMPLETED";

  if (completed || expired) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className="p-6">
          <Brand href="/" />
        </header>
        <main className="flex flex-1 items-center justify-center p-6">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Welcome to ACT</CardTitle>
                <Badge variant={completed ? "success" : "destructive"}>
                  {completed ? "Completed" : "Expired"}
                </Badge>
              </div>
              <CardDescription>
                {completed
                  ? "Your account has been created. Sign in with your username or work email and password."
                  : "This invite has expired. Ask your admin for a new one."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button asChild className="w-full">
                <Link href="/login">Go to sign in</Link>
              </Button>
              {!completed && (
                <p className="text-center text-xs text-muted-foreground">
                  Already finished onboarding? Sign in with the username or email you chose.
                </p>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Terms set by the admin on the invite. Shown for information only; the
  // new hire can't change them and the server ignores anything they send.
  const department = invite.departmentId
    ? await db.department.findUnique({
        where: { id: invite.departmentId },
        select: { name: true },
      })
    : null;
  const terms = [
    invite.jobTitle ? `Role: ${invite.jobTitle}` : null,
    department ? `Department: ${department.name}` : null,
    invite.dateOfHire
      ? `Start date: ${invite.dateOfHire.toLocaleDateString("en-US", { timeZone: "UTC" })}`
      : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="p-6">
        <Brand href="/" />
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-3xl">
          <CardHeader>
            <CardTitle>Welcome to ACT</CardTitle>
            <CardDescription>
              Tell us about yourself and set up your account. This link expires{" "}
              {invite.expiresAt.toLocaleDateString()}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {terms.length > 0 && (
              <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">Your position</p>
                <p>{terms.join(" · ")}</p>
                <p className="mt-1">
                  Your employee ID, pay and these details are set by your admin.
                </p>
              </div>
            )}
            <OnboardingForm token={token} suggestedEmail={invite.email ?? ""} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
