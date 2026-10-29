"use client";
import { usePortalLanguage, PortalLanguageSwitch } from "@/components/portal-language";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { CommandPalette, CommandHint } from "@/components/command-palette";
import { NotificationsRealtime } from "@/components/notifications-realtime";
import { Button } from "@/components/ui/button";
import { Bell, Search, ArrowLeftRight } from "lucide-react";
import type { SessionUser } from "@/lib/auth";

export function AppTopbar({
  user,
  initialUnread = 0,
}: {
  user: SessionUser;
  initialUnread?: number;
}) {
  const { t } = usePortalLanguage();
  const pathname = usePathname() ?? "";
  const isAdminUser = user.role === "ADMIN";
  const inAdminView = pathname.startsWith("/admin");

  const switcherHref = inAdminView ? "/dashboard" : "/admin";
  const switcherLabel = inAdminView ? "Switch to employee view" : t("common.backAdmin");

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/60 sm:gap-3 sm:px-4">
        <SidebarTrigger className="-ml-1 shrink-0" />
        <Separator orientation="vertical" className="hidden h-5 sm:block" />

        {/* Left-aligned brand title — compacts on small screens. */}
        <div className="min-w-0 flex-1 truncate">
          <span className="hidden text-sm font-semibold tracking-tight md:inline">
            American Completion Tools
          </span>
          <span className="text-sm font-semibold tracking-tight md:hidden">
            ACT
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          <Button
            variant="outline"
            size="sm"
            data-command-palette-trigger
            aria-label={t("common.search")}
            aria-controls="app-navigation-search"
            className="h-11 min-w-11 gap-2 px-2.5 text-xs text-muted-foreground md:h-8 md:min-w-0"
            onClick={(e) => {
              e.preventDefault();
              const ev = new KeyboardEvent("keydown", {
                key: "k",
                metaKey: true,
                ctrlKey: true,
                bubbles: true,
              });
              document.dispatchEvent(ev);
            }}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden lg:inline"> {t("common.search")} </span>
            <CommandHint />
          </Button>

          <Button variant="ghost" size="icon" className="relative h-11 w-11 md:h-8 md:w-8" asChild>
            <Link
              href={inAdminView ? "/admin/notifications" : "/dashboard/notifications"}
              aria-label={t("common.notifications")}
            >
              <Bell className="h-4 w-4" />
              <span className="absolute -right-1 -top-1">
                <NotificationsRealtime
                  employeeId={user.employeeId}
                  initialUnread={initialUnread}
                />
              </span>
            </Link>
          </Button>

          {isAdminUser && (
            <Button
              variant="outline"
              size="sm"
              className="h-11 min-w-11 gap-1.5 px-2.5 text-xs md:h-8 md:min-w-0"
              asChild
              title={switcherLabel}
            >
              <Link href={switcherHref}>
                <ArrowLeftRight className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">
                  {inAdminView ? "Employee view" : t("common.adminView")}
                </span>
              </Link>
            </Button>
          )}

          {!inAdminView && <PortalLanguageSwitch />}
          <div className="[&_button]:h-11 [&_button]:w-11 md:[&_button]:h-9 md:[&_button]:w-9"><ThemeToggle /></div>
          <div className="[&>button]:h-11 [&>button]:w-11 md:[&>button]:h-9 md:[&>button]:w-9"><UserMenu
            name={user.name}
            email={user.email}
            profileImage={user.profileImage}
          /></div>
        </div>
      </header>
      <CommandPalette role={inAdminView ? "ADMIN" : "EMPLOYEE"} />
    </>
  );
}
