/**
 * Automatic biweekly pay periods. Pure: given the latest period on the
 * calendar, work out which following periods should exist already.
 */

export type LatestPeriod = {
  /** YYYY-MM-DD */
  start: string;
  end: string;
  payDate: string;
};

export type PlannedPeriod = { start: string; end: string; payDate: string; title: string };

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Most periods created in one go, so a bad date can never flood the calendar. */
export const MAX_AUTO_PERIODS = 6;

export function autoPeriodTitle(start: string, end: string): string {
  return `Pay period ${start} to ${end}`;
}

/**
 * Continue a regular two-week, Monday-to-Sunday calendar. Returns nothing when
 * the latest period does not follow that pattern, because then a person has
 * to decide what comes next. The pay date keeps the same gap after the period
 * end as the latest period.
 */
export function planNextPeriods(
  latest: LatestPeriod,
  today: string,
  aheadDays = 14,
): PlannedPeriod[] {
  const startMs = ms(latest.start);
  const endMs = ms(latest.end);
  const length = Math.round((endMs - startMs) / DAY) + 1;
  const isMonday = new Date(startMs).getUTCDay() === 1;
  const payGap = Math.round((ms(latest.payDate) - endMs) / DAY);
  if (length !== 14 || !isMonday || payGap < 0 || payGap > 10) return [];

  const horizon = ms(today) + aheadDays * DAY;
  const out: PlannedPeriod[] = [];
  let nextStart = endMs + DAY;
  while (nextStart <= horizon && out.length < MAX_AUTO_PERIODS) {
    const nextEnd = nextStart + 13 * DAY;
    const start = iso(nextStart);
    const end = iso(nextEnd);
    out.push({ start, end, payDate: iso(nextEnd + payGap * DAY), title: autoPeriodTitle(start, end) });
    nextStart = nextEnd + DAY;
  }
  return out;
}
