/** Pure validation helpers for employee admin actions (unit-tested). */
import { TERMINATION_GRACE_DAYS } from "@/lib/access";

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Parse a date from a form ("YYYY-MM-DD") or an ISO timestamp. Date-only
 * strings are anchored at UTC midnight so they don't drift by timezone.
 * Returns null for anything that isn't a real calendar date.
 */
export function parseDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const v = value.trim();
  if (!DATE_RE.test(v)) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
  if (Number.isNaN(d.getTime())) return null;
  // Reject rolled-over dates like 2026-02-31.
  if (v.length === 10) {
    const [y, m, day] = v.split("-").map(Number);
    if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) return null;
  }
  return d;
}

/** Today as YYYY-MM-DD in the given IANA zone (default: company zone). */
export function todayDateString(now: Date = new Date(), timeZone = "America/Chicago"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export type DateCheck = { ok: true; date: Date } | { ok: false; error: string };

export function checkDateOfBirth(value: string, now: Date = new Date()): DateCheck {
  const d = parseDateInput(value);
  if (!d) return { ok: false, error: "Enter a valid date of birth." };
  if (d.getUTCFullYear() < 1900 || d.getTime() > now.getTime())
    return { ok: false, error: "Date of birth must be in the past (after 1900)." };
  return { ok: true, date: d };
}

export function checkDateOfHire(value: string, now: Date = new Date()): DateCheck {
  const d = parseDateInput(value);
  if (!d) return { ok: false, error: "Enter a valid date of hire." };
  const y = d.getUTCFullYear();
  if (y < 1950 || y > now.getUTCFullYear() + 2)
    return { ok: false, error: "Date of hire looks wrong. Check the year." };
  return { ok: true, date: d };
}

/** Termination can be backdated but not set in the future. */
export function checkTerminationDate(value: string, now: Date = new Date()): DateCheck {
  const d = parseDateInput(value);
  if (!d) return { ok: false, error: "Enter a valid termination date." };
  if (d.getUTCFullYear() < 1990)
    return { ok: false, error: "Termination date looks wrong. Check the year." };
  // One day of slack so "today" in the business timezone is always accepted.
  if (d.getTime() > now.getTime() + 86_400_000)
    return {
      ok: false,
      error:
        "Termination date can't be in the future. Set the status on the day it takes effect.",
    };
  return { ok: true, date: d };
}

/** Last day a terminated employee can still sign in (read-only). */
export function readOnlyUntil(terminationDate: Date): Date {
  return new Date(terminationDate.getTime() + TERMINATION_GRACE_DAYS * 86_400_000);
}

/**
 * Would making `supervisorId` the supervisor of `employeeId` create a loop
 * (including supervising yourself)? `supervisorOf` maps employee id -> their
 * supervisor id.
 */
export function createsSupervisorCycle(
  employeeId: string,
  supervisorId: string,
  supervisorOf: Map<string, string | null>,
): boolean {
  const seen = new Set<string>();
  let cur: string | null | undefined = supervisorId;
  while (cur) {
    if (cur === employeeId) return true;
    if (seen.has(cur)) return true; // pre-existing loop; refuse to extend it
    seen.add(cur);
    cur = supervisorOf.get(cur);
  }
  return false;
}

const SENSITIVE_FIELDS = new Set(["ssnLast4", "dateOfBirth"]);

/**
 * Field-level diff for the audit log: only changed fields, old -> new, with
 * SSN / date of birth redacted (we record THAT they changed, not the value).
 */
export function auditDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown } | "[changed]"> {
  const norm = (v: unknown) =>
    v instanceof Date ? v.toISOString().slice(0, 10) : v === undefined ? null : v;
  const out: Record<string, { from: unknown; to: unknown } | "[changed]"> = {};
  for (const key of Object.keys(after)) {
    const a = norm(before[key]);
    const b = norm(after[key]);
    if (String(a ?? "") === String(b ?? "")) continue;
    out[key] = SENSITIVE_FIELDS.has(key) ? "[changed]" : { from: a, to: b };
  }
  return out;
}
