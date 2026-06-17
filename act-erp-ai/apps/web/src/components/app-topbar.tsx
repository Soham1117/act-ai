"use client";

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
  const pathname = usePathname() ?? "";
  const isAdminUser = user.role === "ADMIN";
  const inAdminView = pathname.startsWith("/admin");

  const switcherHref = inAdminView ? "/dashboard" : "/admin";
  const switcherLabel = inAdminView ? "Switch to employee view" : "Back to admin";

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/60 sm:gap-3 sm:px-4">
        <SidebarTrigger className="-ml-1 shrink-0" />
        <Separator orientation="vertical" className="hidden h-5 sm:block" />

        {/* Left-aligned brand title — compacts on small screens. */}
        <div className="min-w-0 truncate">
          <span className="hidden text-sm font-semibold tracking-tight md:inline">
            American Completion Tools
          </span>
          <span className="text-sm font-semibold tracking-tight md:hidden">
            ACT
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 px-2.5 text-xs text-muted-foreground"
            onClick={(e) => {
              e.preventDefault();
              const ev = new KeyboardEvent("keydown", { key: "k", metaKey: true });
              document.dispatchEvent(ev);
            }}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Search</span>
            <CommandHint />
          </Button>

          <Button variant="ghost" size="icon" className="relative h-8 w-8" asChild>
            <Link
              href={inAdminView ? "/admin/notifications" : "/dashboard/notifications"}
              aria-label="Notifications"
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
              className="h-8 gap-1.5 px-2.5 text-xs"
              asChild
              title={switcherLabel}
            >
              <Link href={switcherHref}>
                <ArrowLeftRight className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">
                  {inAdminView ? "Employee view" : "Admin view"}
                </span>
              </Link>
            </Button>
          )}

          <ThemeToggle />
          <UserMenu
            name={user.name}
            email={user.email}
            profileImage={user.profileImage}
          />
        </div>
      </header>
      <CommandPalette role={inAdminView ? "ADMIN" : "EMPLOYEE"} />
    </>
  );
}
