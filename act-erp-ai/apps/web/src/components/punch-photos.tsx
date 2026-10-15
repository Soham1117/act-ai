"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBusinessTime } from "@/lib/format";

type Side = "in" | "out";

type Props = {
  type: "employee" | "contract";
  entryId: string;
  hasIn: boolean;
  hasOut: boolean;
  /** "KIOSK" when the punch came from a kiosk. Anything else shows nothing. */
  source?: string | null;
  /** ISO strings, shown under the large photos. */
  clockIn?: string | null;
  clockOut?: string | null;
  /** Show only the clock-in thumbnail (for example the On site list). */
  inOnly?: boolean;
};

function photoUrl(type: Props["type"], id: string, side: Side) {
  return `/api/punch-photo?type=${type}&id=${encodeURIComponent(id)}&side=${side}`;
}

export function PunchPhotos({
  type,
  entryId,
  hasIn,
  hasOut,
  source,
  clockIn,
  clockOut,
  inOnly = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const fromKiosk = source === "KIOSK";
  const sides: Side[] = inOnly ? ["in"] : ["in", "out"];
  const has = (s: Side) => (s === "in" ? hasIn : hasOut);

  if (!hasIn && !hasOut && !fromKiosk) return null;

  return (
    <>
      <div className="flex items-center gap-1">
        {sides.map((s) =>
          has(s) ? (
            <button
              key={s}
              type="button"
              onClick={() => setOpen(true)}
              title={s === "in" ? "Clock in photo" : "Clock out photo"}
              className="h-8 w-8 shrink-0 overflow-hidden rounded border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl(type, entryId, s)}
                alt={s === "in" ? "Clock in" : "Clock out"}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ) : fromKiosk && (s === "in" || clockOut) ? (
            <Badge key={s} variant="outline" className="text-[10px] font-normal text-muted-foreground">
              No photo{inOnly ? "" : s === "in" ? " (in)" : " (out)"}
            </Badge>
          ) : null,
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Punch photos</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {sides.map((s) => {
              const t = s === "in" ? clockIn : clockOut;
              return (
                <div key={s} className="space-y-1">
                  <p className="text-sm font-medium">
                    {s === "in" ? "Clock in" : "Clock out"}
                    {t && (
                      <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                        {formatBusinessTime(t)}
                      </span>
                    )}
                  </p>
                  {has(s) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photoUrl(type, entryId, s)}
                      alt={s === "in" ? "Clock in" : "Clock out"}
                      loading="lazy"
                      className="aspect-[4/3] w-full rounded-md border bg-muted object-cover"
                    />
                  ) : (
                    <div className="grid aspect-[4/3] w-full place-items-center rounded-md border bg-muted text-xs text-muted-foreground">
                      No photo
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
