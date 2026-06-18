"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Credentials auth has no self-service email reset (no mail provider wired).
 * Admins reset passwords from the employee admin page; new hires set theirs
 * during onboarding. This page just explains that.
 */
export function ForgotPasswordForm() {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Password resets are handled by your administrator. Contact your admin to have
        your password reset, then sign in with the new password.
      </p>
      <Button asChild className="w-full">
        <Link href="/login">Back to sign in</Link>
      </Button>
    </div>
  );
}
