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
