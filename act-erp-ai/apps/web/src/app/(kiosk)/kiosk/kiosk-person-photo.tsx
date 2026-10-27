"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

export function KioskPersonPhoto({
  photoUrl,
  fallbackUrl,
  name,
  className,
  fallbackClassName,
  sizes,
}: {
  photoUrl: string | null;
  fallbackUrl?: string | null;
  name: string;
  className?: string;
  fallbackClassName?: string;
  sizes?: string;
}) {
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const capturedPhoto = photoUrl && !failedUrls.has(photoUrl) ? photoUrl : null;
  const source =
    capturedPhoto ?? (fallbackUrl && !failedUrls.has(fallbackUrl) ? fallbackUrl : null);

  if (!source) return null;

  return (
    <span
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-full",
        capturedPhoto && "aspect-square border bg-muted",
        capturedPhoto ? className : fallbackClassName,
      )}
    >
      <Image
        src={source}
        alt={name}
        fill
        sizes={sizes}
        unoptimized
        className="object-cover object-center"
        onError={() => setFailedUrls((failed) => new Set(failed).add(source))}
      />
    </span>
  );
}
