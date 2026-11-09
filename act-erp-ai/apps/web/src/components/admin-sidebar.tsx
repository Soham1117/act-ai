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
  SidebarMobileNav,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { AssistantNav } from "@/components/assistant-nav";
import { cn } from "@/lib/utils";
import {
  Activity,
  Banknote,
  Bell,
  Building2,
  CalendarDays,
  ClipboardList,
  Clock,
  FileBarChart,
  FileText,
  HardHat,
  HeartPulse,
  Eye,
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
      { href: "/admin/contract-workers", label: "Contract workers", icon: HardHat },
      { href: "/admin/departments", label: "Departments", icon: Building2 },
      { href: "/admin/job-codes", label: "Job codes", icon: Tags },
      { href: "/admin/onboarding", label: "Onboarding", icon: Shield },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/admin/hours", label: "Hours", icon: Clock },
      { href: "/admin/schedules", label: "Schedules", icon: CalendarDays },
      { href: "/admin/leave", label: "Leave", icon: Plane },
      { href: "/admin/requests", label: "Requests", icon: ClipboardList },
      { href: "/admin/reimbursements", label: "Reimbursements", icon: Receipt },
      { href: "/admin/payroll", label: "Payroll", icon: Banknote },
      { href: "/admin/benefits", label: "Benefits", icon: HeartPulse },
      { href: "/admin/watch", label: "Watch", icon: Eye },
    ],
  },
  {
    group: "Reports",
    items: [
      { href: "/admin/reports/period", label: "Period reports", icon: FileBarChart },
      { href: "/admin/reports/scheduler", label: "Scheduler reports", icon: CalendarDays },
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

const AI_ONLY_HREFS = new Set(["/admin/chat", "/admin/knowledge"]);

function useAdminNav(aiEnabled: boolean) {
  return aiEnabled
    ? NAV
    : NAV.map((section) => ({
        ...section,
        items: section.items.filter((item) => !AI_ONLY_HREFS.has(item.href)),
      })).filter((section) => section.items.length > 0);
}

/** Hours owns Individual/Group/Mass/… tabs plus Approvals at /admin/time-tracking. */
function isNavActive(pathname: string, href: string) {
  if (href === "/admin/contract-workers" && pathname.startsWith("/admin/contract-workers/mass")) return false;
  if (href === "/admin/hours" && pathname.startsWith("/admin/contract-workers/mass")) return true;
  if (pathname === href) return true;
  if (href === "/admin") return false;
  if (pathname.startsWith(`${href}/`)) return true;
  if (href === "/admin/hours" && pathname.startsWith("/admin/time-tracking")) return true;
  return false;
}

export function AdminSidebar({ aiEnabled = false }: { aiEnabled?: boolean }) {
  const pathname = usePathname();
  const nav = useAdminNav(aiEnabled);

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
        {nav.map((section) => (
          <SidebarGroup key={section.group}>
            <SidebarGroupLabel>{section.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  if (item.href === "/admin/chat")
                    return <AssistantNav key={item.href} basePath={item.href} />;
                  const active = isNavActive(pathname, item.href);
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

/** Plain vertical mobile menu — no SidebarMenu flex primitives. */
export function AdminSidebarMobileNav({ aiEnabled = false }: { aiEnabled?: boolean }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const nav = useAdminNav(aiEnabled);

  return (
    <SidebarMobileNav>
      <Link
        href="/admin"
        className="mb-2 flex items-center px-2 py-1"
        aria-label="American Completion Tools"
        onClick={() => setOpenMobile(false)}
      >
        <Logo priority className="h-7" />
      </Link>
      <nav className="flex w-full flex-col gap-4">
        {nav.map((section) => (
          <div key={section.group} className="flex w-full flex-col gap-1">
            <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/55">
              {section.group}
            </p>
            <ul className="flex w-full list-none flex-col gap-0.5 p-0">
              {section.items.map((item) => {
                const active = isNavActive(pathname, item.href);
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
                      <span className="truncate">{item.label}</span>
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
