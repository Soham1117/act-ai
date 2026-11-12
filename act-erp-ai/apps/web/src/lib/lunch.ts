/**
 * Automatic unpaid lunch. When a worker's time on the clock for a business
 * day (all punches added up) is over 6 hours, 30 minutes come off that day,
 * once. Employees' personal breaks are deducted on top; contract workers
 * cannot take personal breaks. Leave (PTO, holiday, bereavement) never gets a
 * lunch. Applies to shifts dated on or after LUNCH_FROM; earlier entries keep
 * their hours. Pure: no database access.
 */
export const LUNCH_MIN = 30;
export const LUNCH_AFTER_MIN = 6 * 60;
/** First business day the deduction applies to (YYYY-MM-DD). */
export const LUNCH_FROM = "2026-11-12";
/** Leave job codes: never a lunch, never counted toward the 6 hours. */
export const LEAVE_JOB_CODES = new Set(["100", "101", "102"]);

export type LunchShift = {
  id: string;
  clockIn: number;
  /** Clock-in to clock-out, minutes. */
  spanMin: number;
  /** Minutes worked before the lunch (span minus personal breaks). */
  baseMin: number;
};

/**
 * Lunch minutes per shift for one worker's day. The lunch goes on the shift
 * where the day passes 6 hours, so adding a later punch never moves a lunch
 * already taken; if that shift is shorter than the lunch, the rest comes off
 * the shifts before it.
 */
export function allocateDailyLunch(shifts: LunchShift[]): Map<string, number> {
  const out = new Map(shifts.map((s) => [s.id, 0]));
  const ordered = [...shifts].sort((a, b) => a.clockIn - b.clockIn || a.id.localeCompare(b.id));
  let span = 0;
  const carrier = ordered.findIndex((s) => (span += s.spanMin) > LUNCH_AFTER_MIN);
  if (carrier < 0) return out;
  let left = LUNCH_MIN;
  for (let i = carrier; i >= 0 && left > 0; i--) {
    const take = Math.min(left, Math.max(0, ordered[i]!.baseMin));
    out.set(ordered[i]!.id, take);
    left -= take;
  }
  return out;
}
