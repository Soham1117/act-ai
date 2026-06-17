import Link from "next/link";
import { Brand } from "@/components/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Onboarding" };

export default function OnboardLandingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-6">
        <Brand href="/" />
      </header>
      <main className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Onboarding</CardTitle>
            <CardDescription>
              You need a personal invite link from your admin to start onboarding.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              Already have a link? Open it directly — it looks like{" "}
              <code className="text-xs">/onboard/&lt;token&gt;</code>.
            </p>
            <p className="mt-3">
              Existing employee?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Sign in here
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
