import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FilterStack } from "@/components/mobile";
import { cn } from "@/lib/utils";
import type { PeriodPreset } from "@/lib/hours-period";

/** Shared filter row: labels above controls, h-9 controls, Update aligned to bottom. */
export function HoursFilterRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <FilterStack className={cn("items-stretch sm:items-end gap-3", className)}>
      {children}
    </FilterStack>
  );
}

export function HoursField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full flex-col gap-1.5 sm:w-auto", className)}>
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** Period preset chips — uniform height/padding, active state via aria-current when matching. */
export function HoursPresetChips({
  presets,
  hrefFor,
  activeFrom,
  activeTo,
  className,
}: {
  presets: PeriodPreset[];
  hrefFor: (p: PeriodPreset) => string;
  activeFrom?: string;
  activeTo?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="list" aria-label="Period presets">
      {presets.map((p) => {
        const active = activeFrom === p.from && activeTo === p.to;
        return (
          <Button
            key={p.id}
            asChild
            size="sm"
            variant={active ? "secondary" : "outline"}
            className="h-8 rounded-md px-3 text-xs font-medium"
          >
            <Link href={hrefFor(p)} aria-current={active ? "page" : undefined}>
              {p.label}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}

export function HoursToolbarCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn(className)}>
      <CardContent className="space-y-3 p-4">{children}</CardContent>
    </Card>
  );
}

export function HoursStat({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-3 py-2.5",
        className,
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 font-mono text-base font-semibold tabular-nums tracking-tight sm:text-lg">
        {value}
      </div>
    </div>
  );
}

export function HoursStatRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", className)}>
      {children}
    </div>
  );
}

/** Table chrome shared across Hours lists / matrices. */
export const hoursTableClass =
  "w-full border-collapse text-left text-sm";

export const hoursTheadClass =
  "border-b border-border bg-muted/50 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

export const hoursThClass = "px-3 py-2.5 font-medium";

export const hoursTdClass = "px-3 py-2.5 align-middle";

export const hoursRowClass =
  "border-b border-border/60 hover:bg-muted/30";

export const hoursControlClass = "min-h-11 md:min-h-9";
export const hoursLabelClass = "text-xs";
export const hoursEditorClass =
  "min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-6";
export const hoursRowActionClass = "min-h-11 gap-1.5 text-xs md:min-h-9";
