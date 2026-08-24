"use client";

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
  SidebarRail,
} from "@/components/ui/sidebar";
import { AssistantNav } from "@/components/assistant-nav";
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
  items: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }> }>;
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

/** Nav entries that only make sense when the AI feature is switched on. */
const AI_ONLY_HREFS = new Set(["/dashboard/chat"]);

export function EmployeeSidebar({ aiEnabled = false }: { aiEnabled?: boolean }) {
  const pathname = usePathname();
  const nav = aiEnabled
    ? NAV
    : NAV.map((section) => ({
        ...section,
        items: section.items.filter((item) => !AI_ONLY_HREFS.has(item.href)),
      })).filter((section) => section.items.length > 0);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-1.5 text-xs font-medium tracking-wide text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
          My workspace
        </div>
      </SidebarHeader>
      <SidebarContent>
        {nav.map((section) => (
          <SidebarGroup key={section.group}>
            <SidebarGroupLabel>{section.group}</SidebarGroupLabel>
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
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.label}</span>
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
