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
import {
  Banknote,
  Bell,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  Home,
  Plane,
  Receipt,
  Settings,
  User,
  Users,
} from "lucide-react";

const NAV: Array<{
  group: string;
  items: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    group: "Overview",
    items: [{ href: "/dashboard", label: "Home", icon: Home }],
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

export function EmployeeSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-1.5 text-xs font-medium tracking-wide text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
          My workspace
        </div>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((section) => (
          <SidebarGroup key={section.group}>
            <SidebarGroupLabel>{section.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
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
