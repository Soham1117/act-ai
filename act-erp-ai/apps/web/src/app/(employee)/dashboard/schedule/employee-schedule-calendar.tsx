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

export function EmployeeScheduleCalendar({ events: initialEvents }: { events: RawEvent[] }) {
  const { resolvedTheme } = useTheme();
  // Any month (past or future) is fetched on demand as the employee navigates.
  const [events, setEvents] = useState<RawEvent[]>(initialEvents);
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
    events: sxEvents,
    isDark: resolvedTheme === "dark",
    callbacks: {
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
  return (
    <div style={{ height: 600 }}>
      <ScheduleXCalendar calendarApp={calendar} />
    </div>
  );
}
