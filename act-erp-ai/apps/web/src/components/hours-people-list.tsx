import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function HoursPeopleList({
  title,
  allLabel,
  action,
  query,
  filters,
  selectedId,
  items,
  hrefFor,
}: {
  title: string;
  allLabel: string;
  action: string;
  query: string;
  filters: Record<string, string>;
  selectedId: string;
  items: Array<{ id: string; name: string; detail: string }>;
  hrefFor: (id: string) => string;
}) {
  return (
    <Card role="region" aria-label={`${title} picker`} className="h-fit overflow-hidden lg:sticky lg:top-16">
      <CardHeader className="space-y-3 border-b border-border p-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <form method="get" action={action} className="flex gap-2">
          {Object.entries(filters).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <Input
            name="q"
            defaultValue={query}
            placeholder="Search…"
            className="h-11 min-w-0 flex-1 sm:h-9"
            aria-label={`Search ${title.toLowerCase()}`}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="h-11 shrink-0 px-3 sm:h-9"
          >
            Go
          </Button>
        </form>
      </CardHeader>
      <CardContent className="p-0">
        <Link
          href={hrefFor("")}
          aria-current={!selectedId ? "page" : undefined}
          className={cn(
            "block border-b border-border px-3 py-3 text-sm sm:py-2",
            !selectedId ? "bg-muted font-medium" : "hover:bg-muted/50",
          )}
        >
          {allLabel}
        </Link>
        <div className="max-h-40 overflow-y-auto lg:max-h-[min(50vh,28rem)]">
          <ul className="py-1">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={hrefFor(item.id)}
                  aria-current={selectedId === item.id ? "page" : undefined}
                  className={cn(
                    "block min-w-0 px-3 py-3 text-sm sm:py-2",
                    selectedId === item.id ? "bg-muted font-medium" : "hover:bg-muted/50",
                  )}
                >
                  <span className="block truncate leading-snug" title={item.name}>
                    {item.name}
                  </span>
                  <span
                    className="mt-0.5 block truncate text-[11px] text-muted-foreground"
                    title={item.detail}
                  >
                    {item.detail}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {items.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground">
              No matches. Try another search.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
