"use client";

import { usePortalLanguage } from "@/components/portal-language";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Credentials auth has no self-service email reset (no mail provider wired).
 * Admins reset passwords from the employee admin page (the employee is then
 * made to choose their own at next sign-in); new hires set theirs during
 * onboarding. This page just explains that.
 */
export function ForgotPasswordForm() {
  const { t } = usePortalLanguage();
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        {t("recovery.instructions")}
      </p>
      <Button asChild className="w-full">
        <Link href="/login">{t("recovery.back")}</Link>
      </Button>
    </div>
  );
}
