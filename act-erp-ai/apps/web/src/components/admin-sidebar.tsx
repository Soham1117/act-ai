"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
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
  Activity,
  Banknote,
  Bell,
  Building2,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  Home,
  LayoutGrid,
  Library,
  Plane,
  Receipt,
  Settings,
  Shield,
  Sparkles,
  Tags,
  Users,
} from "lucide-react";

const NAV: Array<{
  group: string;
  items: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    group: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: Home },
      { href: "/admin/chat", label: "Assistant", icon: Sparkles },
    ],
  },
  {
    group: "People",
    items: [
      { href: "/admin/employees", label: "Employees", icon: Users },
      { href: "/admin/departments", label: "Departments", icon: Building2 },
      { href: "/admin/job-codes", label: "Job codes", icon: Tags },
      { href: "/admin/onboarding", label: "Onboarding", icon: Shield },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/admin/time-tracking", label: "Time tracking", icon: Clock },
      { href: "/admin/schedules", label: "Schedules", icon: CalendarDays },
      { href: "/admin/leave", label: "Leave", icon: Plane },
      { href: "/admin/requests", label: "Requests", icon: ClipboardList },
      { href: "/admin/reimbursements", label: "Reimbursements", icon: Receipt },
      { href: "/admin/payroll", label: "Payroll", icon: Banknote },
    ],
  },
  {
    group: "Workspace",
    items: [
      { href: "/admin/documents", label: "Documents", icon: FileText },
      { href: "/admin/knowledge", label: "Knowledge base", icon: Library },
      { href: "/admin/activity", label: "Activity", icon: Activity },
      { href: "/admin/notifications", label: "Notifications", icon: Bell },
      { href: "/admin/kiosks", label: "Kiosks", icon: LayoutGrid },
      { href: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/admin"
          className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden"
          aria-label="American Completion Tools"
        >
          <Logo priority className="h-7" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((section) => (
          <SidebarGroup key={section.group}>
            <SidebarGroupLabel>{section.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  if (item.href === "/admin/chat")
                    return <AssistantNav key={item.href} basePath={item.href} />;
                  const active =
                    pathname === item.href ||
                    (item.href !== "/admin" && pathname.startsWith(item.href));
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
