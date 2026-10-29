"use client";
import { usePortalLanguage } from "@/components/portal-language";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import {
  Command,
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
  HardHat,
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
  { label: "Contract workers", href: "/admin/contract-workers", icon: HardHat, group: "Admin", scope: "admin" },
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
  const { t } = usePortalLanguage();
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const focusInput = React.useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => {
          const next = !prev;
          if (next) focusInput();
          return next;
        });
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, focusInput]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-command-palette-trigger]")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const scope = role === "ADMIN" ? "admin" : "employee";
  const items = ITEMS.filter((i) => i.scope === "any" || i.scope === scope);
  const groups = Array.from(new Set(items.map((i) => i.group)));

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      id="app-navigation-search"
      className="min-w-0 border-b bg-popover"
      role="search"
    >
      <div className="flex justify-end px-3 pt-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={() => {
          setOpen(false);
          document.querySelector<HTMLButtonElement>("[data-command-palette-trigger]")?.focus();
        }}>{t("common.close")}</Button>
      </div>
      <Command
        className="rounded-none bg-popover [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-11 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
      >
        <CommandInput
          ref={inputRef}
          placeholder={t("common.searchPlaceholder")}
          autoFocus
        />
        <CommandList className="max-h-[min(50vh,320px)]">
          <CommandEmpty>{t("common.noResults")}</CommandEmpty>
          {groups.map((group, i) => (
            <React.Fragment key={group}>
              {i > 0 && <CommandSeparator />}
              <CommandGroup
                heading={
                  role === "ADMIN"
                    ? group
                    : t("nav." + group.toLowerCase().replace(/ /g, "_"))
                }
              >
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
                      {role === "ADMIN"
                        ? it.label
                        : t("nav." + it.label.toLowerCase().replace(/ /g, "_"))}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </React.Fragment>
          ))}
        </CommandList>
      </Command>
    </div>
  );
}

export function CommandHint() {
  return (
    <kbd className="hidden h-6 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
      <span className="text-xs">⌘</span>K
    </kbd>
  );
}
