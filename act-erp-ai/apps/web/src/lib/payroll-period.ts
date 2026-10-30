import { businessDateOnly } from "@/lib/format";

export type PeriodStatus = "UPCOMING" | "CURRENT" | "COMPLETED";

const key = (d: Date) => d.toISOString().slice(0, 10);

/** Status implied by the dates alone (business calendar day, Central). */
export function derivePeriodStatus(
  start: Date,
  end: Date,
  today: Date = businessDateOnly(),
): PeriodStatus {
  const t = key(today);
  if (t < key(start)) return "UPCOMING";
  if (t > key(end)) return "COMPLETED";
  return "CURRENT";
}

/**
 * The stored status is an admin override only when it says COMPLETED (the
 * admin closed the period early). Every other stored value is just the status
 * at save time, so the display status follows the dates.
 */
export function effectivePeriodStatus(
  stored: PeriodStatus,
  start: Date,
  end: Date,
  today: Date = businessDateOnly(),
): PeriodStatus {
  if (stored === "COMPLETED") return "COMPLETED";
  return derivePeriodStatus(start, end, today);
}

export type PeriodDatesCheck = { ok: true } | { ok: false; error: string };

/** Inclusive payroll ranges overlap when each starts on or before the other's end. */
export function payrollPeriodsOverlap(
  start: Date,
  end: Date,
  otherStart: Date,
  otherEnd: Date,
): boolean {
  return start.getTime() <= otherEnd.getTime() && otherStart.getTime() <= end.getTime();
}

/** end >= start and payDate >= end. Inputs are YYYY-MM-DD strings. */
export function validatePeriodDates(start: string, end: string, payDate: string): PeriodDatesCheck {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (![start, end, payDate].every((s) => re.test(s) && !Number.isNaN(Date.parse(s)))) {
    return { ok: false, error: "Enter valid dates for the period start, end, and pay date." };
  }
  if (end < start) return { ok: false, error: "The period end can't be before the period start." };
  if (payDate < end) return { ok: false, error: "The pay date can't be before the period end." };
  return { ok: true };
}

/** Error-message prefix the upload dialog keys off to offer "Replace". */
export const PAYROLL_DUPLICATE_PREFIX = "Duplicate pay document:";

/**
 * What an admin needs to know about a period.
 * - Closed: exported and closed by an admin (hours are locked).
 * - Ready: the last day has passed and nothing is pending or still open.
 * - Review: the last day has passed but entries still need approving or closing.
 */
export type PeriodState = "UPCOMING" | "CURRENT" | "REVIEW" | "READY" | "CLOSED";

export function periodState(
  args: {
    start: Date;
    end: Date;
    closedAt: Date | null;
    /** Finished entries still waiting for approval. */
    pending: number;
    /** Entries that are still clocked in. */
    open: number;
  },
  today: Date = businessDateOnly(),
): PeriodState {
  if (args.closedAt) return "CLOSED";
  const dated = derivePeriodStatus(args.start, args.end, today);
  if (dated === "UPCOMING") return "UPCOMING";
  if (dated === "CURRENT") return "CURRENT";
  return args.pending > 0 || args.open > 0 ? "REVIEW" : "READY";
}

export const PERIOD_STATE_LABEL: Record<PeriodState, string> = {
  UPCOMING: "Not started",
  CURRENT: "In progress",
  REVIEW: "Needs review",
  READY: "Ready to export",
  CLOSED: "Closed",
};
