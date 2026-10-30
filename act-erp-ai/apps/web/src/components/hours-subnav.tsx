"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/admin/hours", label: "Individual", exact: true },
  { href: "/admin/hours/group", label: "Group" },
  { href: "/admin/hours/mass", label: "Mass" },
  { href: "/admin/time-tracking", label: "Approvals" },
  { href: "/admin/hours/period-export", label: "Period export" },
  { href: "/admin/hours/timesheets", label: "Time sheets" },
];

export function HoursSubnav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Hours sections"
      className="mb-4 flex min-w-0 gap-1 overflow-x-auto border-b border-border pb-px"
    >
      {LINKS.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "shrink-0 rounded-t-md px-3 py-2 text-sm whitespace-nowrap",
              active
                ? "border-b-2 border-primary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
