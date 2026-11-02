/** Major US holidays on their actual dates (YYYY-MM-DD). Editable list comes later; this is the default. */

function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7);
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function usHolidays(year: number): Map<string, string> {
  const h = new Map<string, string>();
  h.set(iso(year, 0, 1), "New Year's Day");
  h.set(iso(year, 0, nthWeekday(year, 0, 1, 3)), "Martin Luther King Jr. Day");
  h.set(iso(year, 1, nthWeekday(year, 1, 1, 3)), "Presidents' Day");
  h.set(iso(year, 4, lastWeekday(year, 4, 1)), "Memorial Day");
  h.set(iso(year, 5, 19), "Juneteenth");
  h.set(iso(year, 6, 4), "Independence Day");
  h.set(iso(year, 8, nthWeekday(year, 8, 1, 1)), "Labor Day");
  h.set(iso(year, 9, nthWeekday(year, 9, 1, 2)), "Columbus Day");
  h.set(iso(year, 10, 11), "Veterans Day");
  h.set(iso(year, 10, nthWeekday(year, 10, 4, 4)), "Thanksgiving");
  h.set(iso(year, 11, 25), "Christmas Day");
  return h;
}

/** Holiday name for a YYYY-MM-DD date, or null. */
export function holidayName(dateOnly: string): string | null {
  const year = Number(dateOnly.slice(0, 4));
  return usHolidays(year).get(dateOnly) ?? null;
}
