/**
 * Pure time-clock rules: shift length cap, break/work totals, validation of
 * admin-supplied entry times, and business-timezone (America/Chicago) helpers.
 * No DB / framework imports so this stays trivially unit-testable.
 */

export const BUSINESS_TZ = "America/Chicago";

/** Hard cap on a single shift. Anything longer is treated as a forgotten punch. */
export const MAX_SHIFT_MINUTES = 16 * 60;
export const MAX_SHIFT_MS = MAX_SHIFT_MINUTES * 60_000;

const MIN_MS = 60_000;

export type BreakInput = {
  startTime: Date;
  endTime: Date | null;
};

/** True when an open (ACTIVE / ON_BREAK) entry has run past the max shift length. */
export function isStaleShift(clockIn: Date, now: Date = new Date()): boolean {
  return now.getTime() - clockIn.getTime() > MAX_SHIFT_MS;
}

/** The latest instant that may count toward a shift that started at `clockIn`. */
export function shiftCapEnd(clockIn: Date): Date {
  return new Date(clockIn.getTime() + MAX_SHIFT_MS);
}

/** Clamp a proposed clock-out to the max shift length. */
export function capShiftEnd(
  clockIn: Date,
  proposedEnd: Date,
): { end: Date; capped: boolean } {
  const cap = shiftCapEnd(clockIn);
  if (proposedEnd.getTime() > cap.getTime()) return { end: cap, capped: true };
  return { end: proposedEnd, capped: false };
}

function wholeMinutes(ms: number): number {
  return Math.max(0, Math.floor(ms / MIN_MS));
}

/**
 * Duration of one break in whole minutes, clamped to the shift window. An open
 * break is closed at the shift end.
 */
export function breakMinutes(b: BreakInput, clockIn: Date, shiftEnd: Date): number {
  const start = Math.max(b.startTime.getTime(), clockIn.getTime());
  const end = Math.min((b.endTime ?? shiftEnd).getTime(), shiftEnd.getTime());
  return wholeMinutes(end - start);
}

/**
 * Totals for a closed entry. The shift end is capped at 16h after clock-in;
 * `capped` tells the caller the entry needs an admin's attention.
 */
export function computeEntryTotals(args: {
  clockIn: Date;
  clockOut: Date;
  breaks: BreakInput[];
}): { totalBreakMin: number; totalWorkMin: number; capped: boolean; effectiveClockOut: Date } {
  const { end, capped } = capShiftEnd(args.clockIn, args.clockOut);
  const totalBreakMin = args.breaks.reduce(
    (sum, b) => sum + breakMinutes(b, args.clockIn, end),
    0,
  );
  const span = wholeMinutes(end.getTime() - args.clockIn.getTime());
  return {
    totalBreakMin,
    totalWorkMin: Math.max(0, span - totalBreakMin),
    capped,
    effectiveClockOut: end,
  };
}

/**
 * Validate admin-supplied times for an entry. Returns a user-facing message or
 * null when valid. `clockOut` may be null only for an entry that stays open.
 */
export function validateEntryTimes(args: {
  clockIn: Date;
  clockOut: Date | null;
  breaks: { startTime: Date; endTime: Date | null }[];
  now?: Date;
}): string | null {
  const now = args.now ?? new Date();
  const { clockIn, clockOut, breaks } = args;
  const FUTURE_SLACK_MS = 5 * MIN_MS;

  if (Number.isNaN(clockIn.getTime())) return "Clock-in time is not valid.";
  if (clockIn.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    return "Clock-in can't be in the future.";
  }
  if (clockOut) {
    if (Number.isNaN(clockOut.getTime())) return "Clock-out time is not valid.";
    if (clockOut.getTime() <= clockIn.getTime()) {
      return "Clock-out must be after clock-in.";
    }
    if (clockOut.getTime() > now.getTime() + FUTURE_SLACK_MS) {
      return "Clock-out can't be in the future.";
    }
    if (clockOut.getTime() - clockIn.getTime() > MAX_SHIFT_MS) {
      return `A shift can't be longer than ${MAX_SHIFT_MINUTES / 60} hours. Split it into two entries.`;
    }
  }

  const end = clockOut ?? now;
  const closed = breaks
    .filter((b) => b.endTime)
    .map((b) => ({ s: b.startTime.getTime(), e: b.endTime!.getTime() }));
  for (const b of breaks) {
    if (Number.isNaN(b.startTime.getTime())) return "A break start time is not valid.";
    if (b.endTime && Number.isNaN(b.endTime.getTime())) return "A break end time is not valid.";
    if (b.endTime && b.endTime.getTime() <= b.startTime.getTime()) {
      return "Each break must end after it starts.";
    }
    if (b.startTime.getTime() < clockIn.getTime()) {
      return "A break can't start before clock-in.";
    }
    if (b.endTime && clockOut && b.endTime.getTime() > clockOut.getTime()) {
      return "A break can't end after clock-out.";
    }
    if (b.startTime.getTime() > end.getTime()) {
      return "A break can't start after clock-out.";
    }
  }
  closed.sort((a, b) => a.s - b.s);
  for (let i = 1; i < closed.length; i++) {
    if (closed[i]!.s < closed[i - 1]!.e) return "Breaks can't overlap each other.";
  }
  if (clockOut) {
    const totals = computeEntryTotals({ clockIn, clockOut, breaks });
    if (totals.totalBreakMin >= wholeMinutes(clockOut.getTime() - clockIn.getTime())) {
      return "Break time can't cover the entire shift.";
    }
  }
  return null;
}

/** True when two [start, end) intervals overlap. `null` end means open-ended. */
export function intervalsOverlap(
  a: { start: Date; end: Date | null },
  b: { start: Date; end: Date | null },
): boolean {
  const aEnd = a.end ? a.end.getTime() : Infinity;
  const bEnd = b.end ? b.end.getTime() : Infinity;
  return a.start.getTime() < bEnd && b.start.getTime() < aEnd;
}

// ──────────────────────────────────────────────────────────────────────
// Business timezone helpers (America/Chicago)
// ──────────────────────────────────────────────────────────────────────

function tzParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const v = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value);
  return {
    year: v("year"),
    month: v("month"),
    day: v("day"),
    hour: v("hour") % 24,
    minute: v("minute"),
    second: v("second"),
  };
}

/** Offset (minutes, local minus UTC) of `tz` at the given instant. */
function tzOffsetMinutes(date: Date, tz: string): number {
  const p = tzParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / MIN_MS);
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Convert a `YYYY-MM-DDTHH:mm` wall-clock string (as produced by
 * <input type="datetime-local">) in the business timezone to an instant.
 */
export function businessLocalToDate(value: string, tz: string = BUSINESS_TZ): Date | null {
  const m = LOCAL_RE.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMinutes(new Date(asUtc), tz);
  let t = asUtc - off1 * MIN_MS;
  const off2 = tzOffsetMinutes(new Date(t), tz);
  if (off2 !== off1) t = asUtc - off2 * MIN_MS;
  const result = new Date(t);
  // Reject impossible calendar dates like Feb 31 (Date.UTC would roll over).
  const check = new Date(asUtc);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return result;
}

/** Inverse of {@link businessLocalToDate}. */
export function dateToBusinessLocal(date: Date, tz: string = BUSINESS_TZ): string {
  const p = tzParts(date, tz);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** `YYYY-MM-DD` for a date-only (UTC midnight) value. */
export function dateOnlyToString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse `YYYY-MM-DD` into the UTC-midnight representation used by @db.Date. */
export function parseDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || dateOnlyToString(d) !== value) return null;
  return d;
}

/** Monday on or before the given date-only value (UTC-midnight representation). */
export function startOfBusinessWeek(dateOnly: Date): Date {
  const dow = dateOnly.getUTCDay(); // 0 = Sun
  const back = (dow + 6) % 7;
  return new Date(dateOnly.getTime() - back * 86_400_000);
}

export function addDaysDateOnly(dateOnly: Date, days: number): Date {
  return new Date(dateOnly.getTime() + days * 86_400_000);
}

export function startOfBusinessMonth(dateOnly: Date): Date {
  return new Date(Date.UTC(dateOnly.getUTCFullYear(), dateOnly.getUTCMonth(), 1));
}
