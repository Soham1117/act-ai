"use client";

import { useMemo } from "react";
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

export function EmployeeScheduleCalendar({ events }: { events: RawEvent[] }) {
  const { resolvedTheme } = useTheme();
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
  });
  return (
    <div style={{ height: 600 }}>
      <ScheduleXCalendar calendarApp={calendar} />
    </div>
  );
}
