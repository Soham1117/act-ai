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
            <CardContent />
          </Card>
        </main>
      </div>
    );
  }

  const departments = await db.department.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

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
          <CardContent>
            <OnboardingForm
              token={token}
              suggestedEmail={invite.email ?? ""}
              departments={departments}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
