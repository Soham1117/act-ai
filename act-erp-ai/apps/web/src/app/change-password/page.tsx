import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { ChangePasswordForm } from "@/app/(employee)/dashboard/settings/change-password-form";
import { signOut } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ForcedPasswordChangePage() {
  const user = await requireUser();
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
              <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
              <p className="text-sm text-muted-foreground">
                An administrator set a temporary password for your account. Enter it below as
                the current password, then pick your own. You&apos;ll sign in again afterwards.
              </p>
            </div>
          </div>
          <ChangePasswordForm />
          <form action={signOut} className="text-center">
            <Button type="submit" variant="link" size="sm" className="text-xs text-muted-foreground">
              Sign out
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
