import { cn } from "@/lib/utils";

/** Bottom safe-area bar for primary actions on long phone forms. */
export function StickyActionBar({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 -mx-4 mt-4 border-t bg-background/95 px-4 py-3 backdrop-blur",
        "supports-backdrop-filter:bg-background/80",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        "md:static md:mx-0 md:mt-6 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none",
        className,
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">{children}</div>
    </div>
  );
}
