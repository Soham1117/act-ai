import { cn } from "@/lib/utils";

/**
 * Phone: stacked cards. Desktop (md+): optional table/grid slot.
 * Prefer this over wide tables for primary workflows.
 */
export function ResponsiveDataList({
  className,
  mobile,
  desktop,
}: {
  className?: string;
  mobile: React.ReactNode;
  desktop: React.ReactNode;
}) {
  return (
    <div className={cn(className)}>
      <div className="md:hidden print:hidden">{mobile}</div>
      <div className="hidden md:block print:block">{desktop}</div>
    </div>
  );
}

export function DataListCard({
  className,
  children,
  onClick,
}: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted/40 active:bg-muted/60",
          className,
        )}
      >
        {children}
      </button>
    );
  }
  return (
    <div className={cn("w-full rounded-lg border bg-card p-3 text-left shadow-sm", className)}>
      {children}
    </div>
  );
}
