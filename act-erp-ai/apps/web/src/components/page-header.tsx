"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTopbarSlot } from "@/components/topbar-slot";
import { cn } from "@/lib/utils";

/**
 * On md+ the title, hint and actions live in the top bar (AppTopbar owns the
 * #page-header-slot target). Below md the header stays in the page flow.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  const slot = useTopbarSlot("(min-width: 768px)");

  if (slot) {
    return createPortal(
      <>
        {back && (
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="order-1 -ml-1 h-8 w-8 shrink-0"
            title={back.label}
          >
            <Link href={back.href} aria-label={`Back to ${back.label}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
        )}
        <h1 className="order-1 flex min-w-0 shrink-0 items-center gap-1.5 text-sm font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <p
            className="order-3 hidden min-w-0 truncate text-xs text-muted-foreground 2xl:block"
            title={typeof description === "string" ? description : undefined}
          >
            {description}
          </p>
        )}
        {actions && (
          <div className="order-4 ml-auto flex shrink-0 items-center gap-2 [&_button]:min-h-9">
            {actions}
          </div>
        )}
      </>,
      slot,
    );
  }

  return (
    <header className={cn("mb-4 flex flex-col gap-2 md:hidden", className)}>
      {back && (
        <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
          <Link href={back.href}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> {back.label}
          </Link>
        </Button>
      )}
      <div className="min-w-0 space-y-0.5">
        <h1 className="flex flex-wrap items-center gap-1.5 break-words text-lg font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 [&_button]:min-h-11">
          {actions}
        </div>
      )}
    </header>
  );
}

export function StatCard({
  label,
  value,
  delta,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  delta?: { value: string; positive?: boolean };
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="uppercase tracking-wider">{label}</span>
        {icon && <span className="opacity-60">{icon}</span>}
      </div>
      <div className="mt-2 flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {delta && (
          <span
            className={cn(
              "break-words text-xs font-medium",
              delta.positive === false
                ? "text-destructive"
                : delta.positive === true
                ? "text-primary"
                : "text-muted-foreground",
            )}
          >
            {delta.value}
          </span>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
      {icon && (
        <div className="mb-4 rounded-full bg-muted p-3 text-muted-foreground">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
