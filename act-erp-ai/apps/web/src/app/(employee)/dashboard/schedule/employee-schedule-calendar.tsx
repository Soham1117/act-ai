"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useNextCalendarApp, ScheduleXCalendar } from "@schedule-x/react";
import {
  createViewMonthGrid,
  createViewWeek,
} from "@schedule-x/calendar";
import "@schedule-x/theme-default/dist/index.css";
// Must be imported BEFORE any Temporal use — installs polyfill on globalThis
// so Schedule-X's instanceof checks see the same class our events use.
import { Temporal } from "@/lib/temporal-shim";
import { useTheme } from "next-themes";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getMyScheduleEvents } from "@/server/actions/schedules";

type RawEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
};

const TZ = "America/Chicago";
function toZonedDateTime(s: string) {
  return Temporal.ZonedDateTime.from(`${s.replace(" ", "T")}:00[${TZ}]`);
}

/** "2026-10-16 08:00" → "Fri, Oct 16, 2026" and "8:00 AM". */
function formatDay(s: string) {
  return toZonedDateTime(s).toPlainDate().toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function formatTime(s: string) {
  return toZonedDateTime(s).toPlainTime().toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function EmployeeScheduleCalendar({ events: initialEvents }: { events: RawEvent[] }) {
  const { resolvedTheme } = useTheme();
  // Any month (past or future) is fetched on demand as the employee navigates.
  const [events, setEvents] = useState<RawEvent[]>(initialEvents);
  const [openId, setOpenId] = useState<string | null>(null);
  const rangeRef = useRef<string | null>(null);
  const sxEvents = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        title: e.title,
        start: toZonedDateTime(e.start),
        end: toZonedDateTime(e.end),
        description: e.description,
      })),
    [events],
  );
  const calendar = useNextCalendarApp({
    views: [createViewMonthGrid(), createViewWeek()],
    defaultView: "month-grid",
    // Schedule-X renders in UTC unless told otherwise (an 8:00 shift showed as 1:00 PM).
    timezone: TZ,
    events: sxEvents,
    isDark: resolvedTheme === "dark",
    callbacks: {
      onEventClick: (ev) => setOpenId(String(ev.id)),
      onRangeUpdate: (range) => {
        const start = range.start.toPlainDate().toString();
        const end = range.end.toPlainDate().toString();
        const key = start + "|" + end;
        if (rangeRef.current === key) return;
        rangeRef.current = key;
        void getMyScheduleEvents({ start, end }).then((res) => {
          if (res.ok && rangeRef.current === key) setEvents(res.events);
        });
      },
    },
  });
  useEffect(() => {
    calendar?.events.set(sxEvents);
  }, [calendar, sxEvents]);
  const open = openId ? events.find((e) => e.id === openId) : undefined;
  return (
    <>
      <div style={{ height: 600 }}>
        <ScheduleXCalendar calendarApp={calendar} />
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Shift</DialogTitle>
          </DialogHeader>
          {open && (
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Date</dt>
              <dd>{formatDay(open.start)}</dd>
              <dt className="text-muted-foreground">Time</dt>
              <dd>
                {formatTime(open.start)} – {formatTime(open.end)}
                {open.start.slice(0, 10) !== open.end.slice(0, 10) && " (next day)"}
              </dd>
              <dt className="text-muted-foreground">Job code</dt>
              <dd className="font-mono">{open.title}</dd>
              {open.description && (
                <>
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-wrap">{open.description}</dd>
                </>
              )}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
