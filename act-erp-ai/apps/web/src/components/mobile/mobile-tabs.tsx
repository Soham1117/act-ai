"use client";

import { cn } from "@/lib/utils";
import { TabsList } from "@/components/ui/tabs";

/** Scrollable tab chip row for phone; keeps desktop TabsList usable. */
export function MobileTabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsList>) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <TabsList
        className={cn(
          "inline-flex h-auto min-h-9 w-max max-w-none justify-start gap-1 bg-muted p-1",
          className,
        )}
        {...props}
      />
    </div>
  );
}
