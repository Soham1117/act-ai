/**
 * Pure schedule rules. Shifts are stored as a date plus "HH:MM" start/end.
 * When end <= start the shift runs overnight and ends the next calendar day.
 */

export const DAY_MINUTES = 24 * 60;

export function timeToMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return NaN;
  return h * 60 + mi;
}

export function isValidTime(hhmm: string): boolean {
  return !Number.isNaN(timeToMinutes(hhmm));
}

/** A shift whose end is not after its start crosses midnight. */
export function isOvernight(startTime: string, endTime: string): boolean {
  return timeToMinutes(endTime) <= timeToMinutes(startTime);
}

/** Start and end as minutes from 00:00 of the shift's own start date. */
export function shiftSpan(startTime: string, endTime: string): { start: number; end: number } {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += DAY_MINUTES;
  return { start, end };
}

export function shiftDurationMinutes(startTime: string, endTime: string): number {
  const { start, end } = shiftSpan(startTime, endTime);
  return end - start;
}

/** Whole days between two YYYY-MM-DD strings (b - a). */
export function dayDiff(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export type ShiftLike = { date: string; startTime: string; endTime: string };

/**
 * Do two shifts overlap? Works across midnight by placing both on a shared
 * minute axis anchored at the start of `a.date`.
 */
export function shiftsOverlap(a: ShiftLike, b: ShiftLike): boolean {
  const offset = dayDiff(a.date, b.date) * DAY_MINUTES;
  const sa = shiftSpan(a.startTime, a.endTime);
  const sb = shiftSpan(b.startTime, b.endTime);
  return sa.start < sb.end + offset && sb.start + offset < sa.end;
}

/** Calendar date (YYYY-MM-DD) on which the shift ends. */
export function shiftEndDate(date: string, startTime: string, endTime: string): string {
  if (!isOvernight(startTime, endTime)) return date;
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return next.toISOString().slice(0, 10);
}

/** "13:05" -> "1:05 PM". */
export function formatHHMM(hhmm: string): string {
  const mins = timeToMinutes(hhmm);
  if (Number.isNaN(mins)) return hhmm;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "8:00 AM - 5:00 PM" or "10:00 PM - 6:00 AM (+1 day)". */
export function formatShiftRange(startTime: string, endTime: string): string {
  return `${formatHHMM(startTime)} - ${formatHHMM(endTime)}${
    isOvernight(startTime, endTime) ? " (+1 day)" : ""
  }`;
}

/** Start/end as "YYYY-MM-DD HH:mm" strings for the calendar (end lands on the next day for overnight shifts). */
export function shiftDateTimes(
  date: string,
  startTime: string,
  endTime: string,
): { start: string; end: string } {
  return {
    start: `${date} ${startTime}`,
    end: `${shiftEndDate(date, startTime, endTime)} ${endTime}`,
  };
}
