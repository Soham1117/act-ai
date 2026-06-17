"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Building2,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  Home,
  LayoutGrid,
  Plane,
  Receipt,
  Settings,
  Shield,
  Tags,
  Users,
} from "lucide-react";

type Item = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
  scope: "admin" | "employee" | "any";
};

const ITEMS: Item[] = [
  // Admin
  { label: "Admin home", href: "/admin", icon: Home, group: "Admin", scope: "admin" },
  { label: "Employees", href: "/admin/employees", icon: Users, group: "Admin", scope: "admin" },
  { label: "Departments", href: "/admin/departments", icon: Building2, group: "Admin", scope: "admin" },
  { label: "Job codes", href: "/admin/job-codes", icon: Tags, group: "Admin", scope: "admin" },
  { label: "Time tracking", href: "/admin/time-tracking", icon: Clock, group: "Admin", scope: "admin" },
  { label: "Schedules", href: "/admin/schedules", icon: CalendarDays, group: "Admin", scope: "admin" },
  { label: "Leave management", href: "/admin/leave", icon: Plane, group: "Admin", scope: "admin" },
  { label: "Requests", href: "/admin/requests", icon: ClipboardList, group: "Admin", scope: "admin" },
  { label: "Reimbursements", href: "/admin/reimbursements", icon: Receipt, group: "Admin", scope: "admin" },
  { label: "Documents", href: "/admin/documents", icon: FileText, group: "Admin", scope: "admin" },
  { label: "Onboarding invites", href: "/admin/onboarding", icon: Shield, group: "Admin", scope: "admin" },
  { label: "Kiosks", href: "/admin/kiosks", icon: LayoutGrid, group: "Admin", scope: "admin" },
  { label: "Settings", href: "/admin/settings", icon: Settings, group: "Admin", scope: "admin" },

  // Employee
  { label: "Dashboard", href: "/dashboard", icon: Home, group: "Personal", scope: "employee" },
  { label: "My time clock", href: "/dashboard/time-tracking", icon: Clock, group: "Personal", scope: "employee" },
  { label: "My schedule", href: "/dashboard/schedule", icon: CalendarDays, group: "Personal", scope: "employee" },
  { label: "Leave", href: "/dashboard/leave", icon: Plane, group: "Personal", scope: "employee" },
  { label: "Reimbursements", href: "/dashboard/reimbursements", icon: Receipt, group: "Personal", scope: "employee" },
  { label: "My documents", href: "/dashboard/documents", icon: FileText, group: "Personal", scope: "employee" },
  { label: "My team", href: "/dashboard/team", icon: Users, group: "Personal", scope: "employee" },
];

export function CommandPalette({ role }: { role: "ADMIN" | "EMPLOYEE" }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const scope = role === "ADMIN" ? "admin" : "employee";
  const items = ITEMS.filter((i) => i.scope === "any" || i.scope === scope);
  const groups = Array.from(new Set(items.map((i) => i.group)));

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, employees, actions..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {groups.map((group, i) => (
          <React.Fragment key={group}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {items
                .filter((it) => it.group === group)
                .map((it) => (
                  <CommandItem
                    key={it.href}
                    onSelect={() => {
                      setOpen(false);
                      router.push(it.href);
                    }}
                  >
                    <it.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                    {it.label}
                  </CommandItem>
                ))}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

export function CommandHint() {
  return (
    <kbd className="hidden h-6 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
      <span className="text-xs">⌘</span>K
    </kbd>
  );
}
