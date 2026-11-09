"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const EMPLOYEE_LINKS = [
  { href: "/admin/hours", label: "Entries", exact: true },
  { href: "/admin/hours/group", label: "Group totals" },
  { href: "/admin/hours/mass", label: "Bulk entry" },
  { href: "/admin/time-tracking", label: "Approvals" },
  { href: "/admin/hours/period-export", label: "Period export" },
  { href: "/admin/hours/timesheets", label: "Time sheets" },
];
const CONTRACT_LINKS = [
  { href: "/admin/hours/contract-workers", label: "Entries", exact: true },
  { href: "/admin/contract-workers/mass", label: "Bulk entry" },
];

export function HoursSubnav({ from, to }: { from?: string; to?: string } = {}) {
  const pathname = usePathname();
  const contract =
    pathname.startsWith("/admin/hours/contract-workers") ||
    pathname.startsWith("/admin/contract-workers/mass");
  const range = from && to ? `?${new URLSearchParams({ from, to })}` : "";
  const links: Array<{ href: string; label: string; exact?: boolean }> = contract
    ? CONTRACT_LINKS
    : EMPLOYEE_LINKS;
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-2">
      <nav
        aria-label="Hours workforce"
        className="inline-flex max-w-full shrink-0 flex-wrap gap-1 rounded-lg bg-muted p-1"
      >
        {[
          { label: "Employees", href: "/admin/hours", active: !contract },
          {
            label: "Contract workers",
            href: "/admin/hours/contract-workers",
            active: contract,
          },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href + range}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-1.5",
              item.active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <nav
        aria-label="Hours sections"
        className="flex min-w-0 max-w-full gap-1 overflow-x-auto"
      >
        {links.map((link) => {
          const active = link.exact
            ? pathname === link.href
            : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href + (link.exact ? range : "")}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
