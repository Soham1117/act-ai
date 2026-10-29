"use client";

import { PortalLanguageSwitch } from "@/components/portal-language";
import { ThemeToggle } from "@/components/theme-toggle";

/** Top-right language + theme controls for unauthenticated / auth chrome pages. */
export function AuthToolbar() {
  return (
    <div className="flex items-center justify-end gap-2 p-4 sm:p-6">
      <PortalLanguageSwitch />
      <ThemeToggle />
    </div>
  );
}
