/**
 * Business-timezone (America/Chicago) date helpers. Pure and DST-safe: they
 * never rely on the server's local timezone, so they behave the same on a
 * dev laptop (any TZ) and on the prod box.
 *
 * Conventions:
 *  - An "instant" is a normal JS Date.
 *  - A "date-only" value is a Date at UTC midnight (Prisma `@db.Date`).
 */
import { BUSINESS_TIME_ZONE } from "./format";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  weekday: "short",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type BusinessParts = {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday */
  weekday: number;
};

export function businessParts(date: Date = new Date()): BusinessParts {
  const p = fmt.formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** Hour of day (0-23) in business time. */
export function businessHour(date: Date = new Date()): number {
  return businessParts(date).hour;
}

function wallAsUtc(d: Date): number {
  const p = businessParts(d);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/**
 * The instant at which the business-local wall clock reads the given values.
 * Month is 1-12; overflowing day/hour values roll over like Date.UTC.
 * For a nonexistent local time (spring-forward gap) this resolves to the
 * instant just after the gap; for an ambiguous time (fall-back) to the first
 * occurrence.
 */
export function instantFromBusinessTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  // Probe with both plausible US offsets (CST -6h, CDT -5h) and pick the
  // earliest candidate whose wall clock matches; otherwise we are in a gap.
  const candidates = [naive + 5 * 3600_000, naive + 6 * 3600_000];
  const matches = candidates.filter((c) => wallAsUtc(new Date(c)) === naive);
  if (matches.length > 0) return new Date(Math.min(...matches));
  // Gap: local time does not exist. Use the pre-transition offset (CST), which
  // lands just after the gap.
  return new Date(naive + 6 * 3600_000);
}

/** Midnight (00:00 business time) of the business day containing `date`. */
export function startOfBusinessDay(date: Date = new Date()): Date {
  const p = businessParts(date);
  return instantFromBusinessTime(p.year, p.month, p.day);
}

/** Midnight of the business day `n` calendar days after (or before, if negative) the day containing `date`. */
export function addBusinessDays(date: Date, n: number): Date {
  const p = businessParts(date);
  return instantFromBusinessTime(p.year, p.month, p.day + n);
}

/** Start of the business week containing `date` (Monday by default). */
export function startOfBusinessWeek(date: Date = new Date(), weekStartsOn = 1): Date {
  const p = businessParts(date);
  const diff = (p.weekday - weekStartsOn + 7) % 7;
  return instantFromBusinessTime(p.year, p.month, p.day - diff);
}

/** Start of the business month containing `date`; `monthsBack` moves earlier. */
export function startOfBusinessMonth(date: Date = new Date(), monthsBack = 0): Date {
  const p = businessParts(date);
  return instantFromBusinessTime(p.year, p.month - monthsBack, 1);
}

/** Date-only (UTC midnight) value for the business day containing `date`. */
export function businessDayKey(date: Date = new Date()): Date {
  const p = businessParts(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

/**
 * Convert a schedule's date-only value + "HH:MM" business-local time to the
 * actual instant.
 */
export function scheduledInstant(dateOnly: Date, hhmm: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return instantFromBusinessTime(
    dateOnly.getUTCFullYear(),
    dateOnly.getUTCMonth() + 1,
    dateOnly.getUTCDate(),
    h,
    mi,
  );
}

/**
 * Start/end instants of a scheduled shift. An end at or before the start is an
 * overnight shift that finishes the next calendar day.
 */
export function scheduledRange(
  dateOnly: Date,
  startHHMM: string,
  endHHMM: string,
): { start: Date; end: Date } | null {
  const start = scheduledInstant(dateOnly, startHHMM);
  let end = scheduledInstant(dateOnly, endHHMM);
  if (!start || !end) return null;
  if (end.getTime() <= start.getTime()) {
    end = scheduledInstant(new Date(dateOnly.getTime() + 24 * 3600 * 1000), endHHMM);
    if (!end) return null;
  }
  return { start, end };
}

/** Monday (by default) of the week containing a date-only (UTC midnight) value, as a date-only value. */
export function dateOnlyWeekStart(dateOnly: Date, weekStartsOn = 1): Date {
  const diff = (dateOnly.getUTCDay() - weekStartsOn + 7) % 7;
  return new Date(
    Date.UTC(dateOnly.getUTCFullYear(), dateOnly.getUTCMonth(), dateOnly.getUTCDate() - diff),
  );
}

/** "Mar 9" style label for a date-only value (rendered in UTC so it never shifts a day). */
export function dateOnlyShortLabel(dateOnly: Date): string {
  return dateOnly.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** "Mar 26" (month + 2-digit year) label for a date-only value. */
export function dateOnlyMonthLabel(dateOnly: Date): string {
  return dateOnly.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "2-digit" });
}

/** Date-only value `days` after another date-only value. */
export function addDateOnlyDays(dateOnly: Date, days: number): Date {
  return new Date(dateOnly.getTime() + days * 24 * 3600 * 1000);
}
