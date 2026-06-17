import Link from "next/link";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";

export function Brand({
  href = "/",
  className,
}: {
  href?: string;
  showSubtitle?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center", className)}
      aria-label="American Completion Tools"
    >
      <Logo className="h-8" />
    </Link>
  );
}
