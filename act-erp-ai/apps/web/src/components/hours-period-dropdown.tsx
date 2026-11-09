"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function HoursPeriodDropdown({
  options,
  value,
  className,
}: {
  options: { value: string; label: string }[];
  value: string;
  className?: string;
}) {
  const id = useId();
  const router = useRouter();
  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-1.5 sm:w-44", className)}>
      <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Period
      </label>
      <Select value={value} onValueChange={(href) => router.push(href)}>
        <SelectTrigger id={id} className="h-11 w-full min-w-0 md:h-9 [&>span]:truncate">
          <SelectValue placeholder="Custom dates" />
        </SelectTrigger>
        <SelectContent className="w-96 max-w-[calc(100vw-2rem)]">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="whitespace-normal break-words">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
