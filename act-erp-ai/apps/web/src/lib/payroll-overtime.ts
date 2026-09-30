/**
 * Pure weekly-overtime allocation for payroll slips.
 *
 * Overtime is hours over 40 in a Monday-Sunday (ISO) week. Pay periods rarely
 * align to weeks, so a week can straddle two periods. To avoid double counting
 * (or dropping) hours we always look at WHOLE weeks, walk them chronologically,
 * and mark every minute past the 2400th as overtime. A period then only counts
 * the minutes that were actually worked inside it, so the overtime for a
 * straddling week lands in the period where the 40-hour line is crossed.
 *
 * Dates are `YYYY-MM-DD` business-calendar days (TimeEntry.date is a @db.Date),
 * so there is no timezone/DST arithmetic involved in week bucketing.
 */

export const OVERTIME_THRESHOLD_MIN = 40 * 60;

export type SlipEntry = {
  /** Business calendar day, YYYY-MM-DD. */
  date: string;
  /** Tie-breaker for entries on the same day (clock-in epoch ms). */
  clockIn?: number;
  minutes: number;
};

export type WeekAllocation = {
  weekStart: string;
  weekEnd: string;
  regularMin: number;
  overtimeMin: number;
};

export type OvertimeAllocation = {
  weeks: WeekAllocation[];
  regularMin: number;
  overtimeMin: number;
};

function parse(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `day`. */
export function isoWeekStart(day: string): string {
  const d = parse(day);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return fmt(d);
}

/** Sunday of the ISO week containing `day`. */
export function isoWeekEnd(day: string): string {
  const d = parse(isoWeekStart(day));
  d.setUTCDate(d.getUTCDate() + 6);
  return fmt(d);
}

export function allocateWeeklyOvertime(
  entries: SlipEntry[],
  periodStart: string,
  periodEnd: string,
): OvertimeAllocation {
  const sorted = [...entries]
    .filter((e) => e.minutes > 0)
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : (a.clockIn ?? 0) - (b.clockIn ?? 0),
    );

  const cumulative = new Map<string, number>();
  const weeks = new Map<string, WeekAllocation>();

  for (const e of sorted) {
    const wk = isoWeekStart(e.date);
    const before = cumulative.get(wk) ?? 0;
    const after = before + e.minutes;
    cumulative.set(wk, after);

    if (e.date < periodStart || e.date > periodEnd) continue;

    const regular = Math.max(
      0,
      Math.min(after, OVERTIME_THRESHOLD_MIN) - Math.min(before, OVERTIME_THRESHOLD_MIN),
    );
    const overtime = e.minutes - regular;
    let row = weeks.get(wk);
    if (!row) {
      row = { weekStart: wk, weekEnd: isoWeekEnd(wk), regularMin: 0, overtimeMin: 0 };
      weeks.set(wk, row);
    }
    row.regularMin += regular;
    row.overtimeMin += overtime;
  }

  const rows = [...weeks.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  return {
    weeks: rows,
    regularMin: rows.reduce((s, r) => s + r.regularMin, 0),
    overtimeMin: rows.reduce((s, r) => s + r.overtimeMin, 0),
  };
}

// ── CSV helpers (RFC 4180 + formula-injection guard) ───────────────────────

/** Quote every field; neutralise text cells a spreadsheet would treat as formulas. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(",");
}
