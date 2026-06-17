import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Set a new password" };

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-end p-6">
        <ThemeToggle />
      </header>
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex flex-col items-center gap-4">
            <Logo priority width={180} height={72} className="h-12" />
            <div className="space-y-1 text-center">
              <h1 className="text-2xl font-bold tracking-tight">Set a new password</h1>
              <p className="text-sm text-muted-foreground">
                Pick something secure — at least 8 characters.
              </p>
            </div>
          </div>
          <ResetPasswordForm />
        </div>
      </main>
      <footer className="p-6 text-center text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} American Completion Tools
      </footer>
    </div>
  );
}
