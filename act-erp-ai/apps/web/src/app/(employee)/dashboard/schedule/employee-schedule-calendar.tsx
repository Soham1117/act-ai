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
import { storedTimeContent } from "@/lib/schedule-display";
import { toast } from "sonner";
import { usePortalLanguage } from "@/components/portal-language";

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

/** Format stored dates and wall-clock times without shifting DST gap times. */
function formatDay(s: string, locale: string) {
  return toZonedDateTime(s).toPlainDate().toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function formatStoredTime(s: string, locale: string) {
  const [hour, minute] = s.slice(11, 16).split(":").map(Number);
  const value = new Date(Date.UTC(1970, 0, 1, hour!, minute!));
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(value);
}

const CALENDAR_TRANSLATION_KEYS = {
  Today: "time.calendar.today",
  Month: "time.calendar.month",
  Week: "time.calendar.week",
  Day: "time.calendar.day",
  List: "time.calendar.list",
  "Select View": "time.calendar.selectView",
  View: "time.calendar.view",
  "+ {{n}} events": "time.calendar.moreEvents",
  "+ 1 event": "time.calendar.oneEvent",
  "No events": "time.calendar.noEvents",
  "Next period": "time.calendar.nextPeriod",
  "Previous period": "time.calendar.previousPeriod",
  to: "time.calendar.to",
  "Full day- and multiple day events": "time.calendar.fullDay",
  "Link to {{n}} more events on {{date}}": "time.calendar.moreOnDate",
  "Link to 1 more event on {{date}}": "time.calendar.oneMoreOnDate",
  CW: "time.calendar.weekNumber",
  Date: "time.calendar.dateLabel",
  "MM/DD/YYYY": "time.calendar.dateFormat",
  "Next month": "time.calendar.nextMonth",
  "Previous month": "time.calendar.previousMonth",
  "Choose Date": "time.calendar.chooseDate",
} as const;

const calendarTranslations = (t: (key: string) => string) =>
  Object.fromEntries(
    Object.entries(CALENDAR_TRANSLATION_KEYS).map(([label, key]) => [
      label,
      t(key).replace(/\{(n|date)\}/g, "{{$1}}"),
    ]),
  );

function displayJobTitle(event: RawEvent, t: (key: string) => string) {
  const overnightSuffix = " (+1 day)";
  const jobCode = event.title.endsWith(overnightSuffix)
    ? event.title.slice(0, -overnightSuffix.length)
    : event.title;
  return event.start.slice(0, 10) !== event.end.slice(0, 10)
    ? `${jobCode} (${t("time.schedule.nextDayShort")})`
    : jobCode;
}

export function EmployeeScheduleCalendar({ events: initialEvents }: { events: RawEvent[] }) {
  const { t, locale } = usePortalLanguage();
  const translations = useMemo(() => calendarTranslations(t), [t]);
  return (
    <ScheduleCalendar
      key={locale}
      initialEvents={initialEvents}
      t={t}
      locale={locale}
      translations={translations}
    />
  );
}

function ScheduleCalendar({
  initialEvents,
  t,
  locale,
  translations,
}: {
  initialEvents: RawEvent[];
  t: (key: string, params?: Record<string, string | number>) => string;
  locale: string;
  translations: Record<string, string>;
}) {
  const { resolvedTheme } = useTheme();
  // Any month (past or future) is fetched on demand as the employee navigates.
  const [events, setEvents] = useState<RawEvent[]>(initialEvents);
  const [openId, setOpenId] = useState<string | null>(null);
  const rangeRef = useRef<string | null>(null);
  const sxEvents = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        title: displayJobTitle(e, t),
        start: toZonedDateTime(e.start),
        end: toZonedDateTime(e.end),
        description: e.description,
        _customContent: storedTimeContent({ ...e, title: displayJobTitle(e, t) }),
      })),
    [events, t],
  );
  const calendar = useNextCalendarApp({
    views: [createViewMonthGrid(), createViewWeek()],
    defaultView: "month-grid",
    // Schedule-X renders in UTC unless told otherwise (an 8:00 shift showed as 1:00 PM).
    timezone: TZ,
    locale,
    translations: { [locale]: translations },
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
        getMyScheduleEvents({ start, end })
          .then((res) => {
            if (rangeRef.current !== key) return;
            if (res.ok) setEvents(res.events);
            else toast.error(t("time.schedule.loadError"));
          })
          .catch(() => {
            if (rangeRef.current === key) toast.error(t("time.schedule.loadError"));
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
            <DialogTitle>{t("time.schedule.shift")}</DialogTitle>
          </DialogHeader>
          {open && (
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("time.schedule.date")}</dt>
              <dd>{formatDay(open.start, locale)}</dd>
              <dt className="text-muted-foreground">{t("time.schedule.time")}</dt>
              <dd>
                {formatStoredTime(open.start, locale)} – {formatStoredTime(open.end, locale)}
                {open.start.slice(0, 10) !== open.end.slice(0, 10) && ` (${t("time.schedule.nextDay")})`}
              </dd>
              <dt className="text-muted-foreground">{t("time.schedule.jobCode")}</dt>
              <dd className="font-mono">{displayJobTitle(open, t)}</dd>
              {open.description && (
                <>
                  <dt className="text-muted-foreground">{t("time.schedule.notes")}</dt>
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
