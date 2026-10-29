"use client";
import { usePortalLanguage } from "@/components/portal-language";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMobileNav,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { AssistantNav } from "@/components/assistant-nav";
import { cn } from "@/lib/utils";
import {
  Banknote,
  Bell,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  HeartPulse,
  Home,
  Plane,
  Receipt,
  Settings,
  Sparkles,
  User,
  Users,
} from "lucide-react";

const NAV: Array<{
  group: string;
  items: Array<{
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}> = [
  {
    group: "Overview",
    items: [
      { href: "/dashboard", label: "Home", icon: Home },
      { href: "/dashboard/chat", label: "Assistant", icon: Sparkles },
    ],
  },
  {
    group: "Time",
    items: [
      { href: "/dashboard/time-tracking", label: "Timesheet", icon: Clock },
      { href: "/dashboard/schedule", label: "Schedule", icon: CalendarDays },
      { href: "/dashboard/leave", label: "Leave", icon: Plane },
    ],
  },
  {
    group: "Workspace",
    items: [
      { href: "/dashboard/requests", label: "Requests", icon: ClipboardList },
      { href: "/dashboard/reimbursements", label: "Reimbursements", icon: Receipt },
      { href: "/dashboard/payroll", label: "Payroll", icon: Banknote },
      { href: "/dashboard/benefits", label: "Benefits", icon: HeartPulse },
      { href: "/dashboard/documents", label: "Documents", icon: FileText },
      { href: "/dashboard/team", label: "My team", icon: Users },
    ],
  },
  {
    group: "Account",
    items: [
      { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
      { href: "/dashboard/my-details", label: "My details", icon: User },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

const AI_ONLY_HREFS = new Set(["/dashboard/chat"]);

function useEmployeeNav(aiEnabled: boolean) {
  return aiEnabled
    ? NAV
    : NAV.map((section) => ({
        ...section,
        items: section.items.filter((item) => !AI_ONLY_HREFS.has(item.href)),
      })).filter((section) => section.items.length > 0);
}

export function EmployeeSidebar({ aiEnabled = false }: { aiEnabled?: boolean }) {
  const { t } = usePortalLanguage();
  const pathname = usePathname();
  const nav = useEmployeeNav(aiEnabled);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-1.5 text-xs font-medium tracking-wide text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
          {" "}
          {t("common.workspace")}{" "}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {nav.map((section) => (
          <SidebarGroup key={section.group}>
            <SidebarGroupLabel>
              {t("nav." + section.group.toLowerCase().replace(/ /g, "_"))}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  if (item.href === "/dashboard/chat")
                    return <AssistantNav key={item.href} basePath={item.href} />;
                  const active =
                    pathname === item.href ||
                    (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={t("nav." + item.label.toLowerCase().replace(/ /g, "_"))}
                      >
                        <Link href={item.href}>
                          <item.icon className="h-4 w-4" />
                          <span>
                            {t("nav." + item.label.toLowerCase().replace(/ /g, "_"))}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

export function EmployeeSidebarMobileNav({ aiEnabled = false }: { aiEnabled?: boolean }) {
  const { t } = usePortalLanguage();
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const nav = useEmployeeNav(aiEnabled);

  return (
    <SidebarMobileNav>
      <nav className="flex w-full flex-col gap-4">
        {nav.map((section) => (
          <div key={section.group} className="flex w-full flex-col gap-1">
            <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/55">
              {t("nav." + section.group.toLowerCase().replace(/ /g, "_"))}
            </p>
            <ul className="flex w-full list-none flex-col gap-0.5 p-0">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href));
                const label = t("nav." + item.label.toLowerCase().replace(/ /g, "_"));
                return (
                  <li key={item.href} className="w-full">
                    <Link
                      href={item.href}
                      onClick={() => setOpenMobile(false)}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </SidebarMobileNav>
  );
}
