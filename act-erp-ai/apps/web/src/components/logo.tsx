import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Wordmark logo. Picks the dark-text version on light backgrounds and the
 * white-text version in dark mode using `dark:` Tailwind variants — no client
 * JS required.
 */
export function Logo({
  className,
  width = 140,
  height = 56,
  priority = false,
}: {
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
}) {
  return (
    <span className={cn("inline-block", className)}>
      <Image
        src="/act-logo-black-text.svg"
        alt="American Completion Tools"
        width={width}
        height={height}
        priority={priority}
        className="block h-full w-auto dark:hidden"
      />
      <Image
        src="/act-logo-white-text.svg"
        alt=""
        aria-hidden
        width={width}
        height={height}
        priority={priority}
        className="hidden h-full w-auto dark:block"
      />
    </span>
  );
}
