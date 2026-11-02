"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useTopbarSlot } from "@/components/topbar-slot";

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
  const slot = useTopbarSlot("(min-width: 1280px)");
  const isActive = (link: (typeof LINKS)[number]) =>
    link.exact
      ? pathname === link.href
      : pathname === link.href || pathname.startsWith(`${link.href}/`);

  if (slot) {
    return createPortal(
      <nav
        aria-label="Hours sections"
        className="order-2 inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5"
      >
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              isActive(link)
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>,
      slot,
    );
  }

  return (
    <nav
      aria-label="Hours sections"
      className="mb-4 flex min-w-0 gap-1 overflow-x-auto border-b border-border pb-px xl:hidden"
    >
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
            isActive(link)
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
