/**
 * Leave balance engine — PURE (no DB, no server-only imports) so it can be
 * unit-tested and also used in client components (live day count in the
 * request dialog). The DB loader lives in `leave-balance-db.ts`.
 *
 * All dates are "date-only" values: JS Dates at UTC midnight (how Prisma
 * returns `@db.Date`). Only UTC getters are used, so results never depend on
 * the server timezone. "Today" should be `businessDateOnly()` (Central).
 *
 * Model (per employee, per leave type, per calendar year):
 *
 *   available = earned + carryover + adjustments - used
 *
 *  - earned: per policy.
 *      ANNUAL_GRANT: the full `daysPerYear` on Jan 1. In the hire year it is
 *        pro-rated by whole months remaining after the hire date (hired on the
 *        1st counts that month), rounded to the nearest half day.
 *      MONTHLY: `daysPerYear / 12` per COMPLETED month (accrues at month end).
 *        In the hire year accrual starts with the first full month after
 *        hire (a hire on the 1st counts that month). Past years = full year.
 *        Future years earn 0 (so MONTHLY employees cannot book next year
 *        beyond carryover until it accrues).
 *  - carryover: min(policy.carryoverMax, unused balance of the PRIOR year),
 *      where the prior year's balance is computed WITHOUT its own carryover
 *      (one year back only, non-recursive). Deliberately conservative and
 *      deterministic; carryoverMax = 0 means use-it-or-lose-it.
 *  - adjustments: sum of admin LeaveAdjustment rows for that year/type.
 *  - used: PENDING + APPROVED requests; multi-day requests are split by day
 *      so each calendar year is charged only for its own days.
 *  - unlimited types never block and report `available: null`.
 *
 * Day counting: Mon–Fri only, minus company holidays (optional set; the app
 * has no holiday calendar yet, so callers pass none). A half day on the start
 * and/or end date subtracts 0.5 each; a single-day request with a half-day
 * flag counts 0.5 total.
 */

export const LEAVE_TYPES = [
  "ANNUAL", "SICK", "PERSONAL", "EMERGENCY", "MATERNITY", "PATERNITY",
  "VACATION", "FAMILY", "BEREAVEMENT", "OTHER",
] as const;
export type LeaveTypeKey = (typeof LEAVE_TYPES)[number];

export type AccrualMode = "ANNUAL_GRANT" | "MONTHLY";

export type LeavePolicyValues = {
  daysPerYear: number;
  unlimited: boolean;
  accrualMode: AccrualMode;
  carryoverMax: number;
};

/**
 * Defaults used when a type has no LeavePolicy row. Paid time off
 * (ANNUAL + VACATION) totals 20 days, matching the legacy Employee.totalLeaves
 * pool of 20; SICK/PERSONAL/EMERGENCY have small separate allowances; the
 * event-driven types are unlimited. Admins tune these in Admin > Leave >
 * Policy. `scripts/seed-leave-policy.ts` writes these rows to the DB.
 */
export const DEFAULT_LEAVE_POLICIES: Record<LeaveTypeKey, LeavePolicyValues> = {
  ANNUAL: { daysPerYear: 10, unlimited: false, accrualMode: "ANNUAL_GRANT", carryoverMax: 0 },
  VACATION: { daysPerYear: 10, unlimited: false, accrualMode: "ANNUAL_GRANT", carryoverMax: 0 },
  SICK: { daysPerYear: 5, unlimited: false, accrualMode: "ANNUAL_GRANT", carryoverMax: 0 },
  PERSONAL: { daysPerYear: 3, unlimited: false, accrualMode: "ANNUAL_GRANT", carryoverMax: 0 },
  EMERGENCY: { daysPerYear: 2, unlimited: false, accrualMode: "ANNUAL_GRANT", carryoverMax: 0 },
  FAMILY: { daysPerYear: 0, unlimited: true, accrualMode: "ANNUAL_GRANT", carryoverMax: 0 },
  OTHER: { daysPerYear: 0, unlimited: true, accrualMode: "ANNUAL_GRANT", carryoverMax: 0 },
  MATERNITY: { daysPerYear: 0, unlimited: true, accrualMode: "ANNUAL_GRANT", carryoverMax: 0 },
  PATERNITY: { daysPerYear: 0, unlimited: true, accrualMode: "ANNUAL_GRANT", carryoverMax: 0 },
  BEREAVEMENT: { daysPerYear: 0, unlimited: true, accrualMode: "ANNUAL_GRANT", carryoverMax: 0 },
};

export type PolicyMap = Partial<Record<string, LeavePolicyValues>>;

export function policyFor(policies: PolicyMap, type: string): LeavePolicyValues {
  return (
    policies[type] ??
    DEFAULT_LEAVE_POLICIES[type as LeaveTypeKey] ?? {
      daysPerYear: 0, unlimited: true, accrualMode: "ANNUAL_GRANT", carryoverMax: 0,
    }
  );
}

// ── Date helpers (UTC date-only) ─────────────────────────────────────────

const DAY_MS = 86_400_000;

export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse "YYYY-MM-DD" to UTC midnight; null if malformed / impossible. */
export function parseDateOnly(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || dateKey(d) !== s) return null;
  return d;
}

export function isBusinessDay(d: Date, holidays?: ReadonlySet<string>): boolean {
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !holidays?.has(dateKey(d));
}

export type LeaveRange = {
  startDate: Date;
  endDate: Date;
  startHalfDay?: boolean;
  endHalfDay?: boolean;
};

/** Every chargeable day of a range with its weight (1 or 0.5). */
export function dayWeights(
  range: LeaveRange,
  holidays?: ReadonlySet<string>,
): Array<{ date: Date; weight: number }> {
  const out: Array<{ date: Date; weight: number }> = [];
  const s = range.startDate.getTime();
  const e = range.endDate.getTime();
  if (e < s) return out;
  const single = s === e;
  for (let t = s; t <= e; t += DAY_MS) {
    const date = new Date(t);
    if (!isBusinessDay(date, holidays)) continue;
    let weight = 1;
    if (single) {
      if (range.startHalfDay || range.endHalfDay) weight = 0.5;
    } else {
      if (t === s && range.startHalfDay) weight = 0.5;
      if (t === e && range.endHalfDay) weight = 0.5;
    }
    out.push({ date, weight });
  }
  return out;
}

/** Total chargeable days (what the server stores in `totalDays`). */
export function leaveDaysForRange(range: LeaveRange, holidays?: ReadonlySet<string>): number {
  return dayWeights(range, holidays).reduce((s, d) => s + d.weight, 0);
}

/** Chargeable days per calendar year (year-boundary split). */
export function splitDaysByYear(
  range: LeaveRange,
  holidays?: ReadonlySet<string>,
): Map<number, number> {
  const m = new Map<number, number>();
  for (const { date, weight } of dayWeights(range, holidays)) {
    const y = date.getUTCFullYear();
    m.set(y, (m.get(y) ?? 0) + weight);
  }
  return m;
}

/** Inclusive date-range overlap. */
export function rangesOverlap(
  a: { startDate: Date; endDate: Date },
  b: { startDate: Date; endDate: Date },
): boolean {
  return a.startDate.getTime() <= b.endDate.getTime() && a.endDate.getTime() >= b.startDate.getTime();
}

// ── Accrual ──────────────────────────────────────────────────────────────

const round1 = (n: number) => Math.round(n * 10) / 10;
const roundHalf = (n: number) => Math.round(n * 2) / 2;

/** First month index (0-11) of the hire year that counts as a full month. */
function firstFullMonthIndex(hire: Date): number {
  return hire.getUTCMonth() + (hire.getUTCDate() > 1 ? 1 : 0);
}

/** Days earned in `year` (excluding carryover/adjustments). */
export function earnedForYear(
  policy: LeavePolicyValues,
  year: number,
  hireDate: Date | null,
  today: Date,
): number {
  const hireYear = hireDate ? hireDate.getUTCFullYear() : null;
  if (hireYear !== null && year < hireYear) return 0;
  const dpy = policy.daysPerYear;
  if (dpy <= 0) return 0;

  if (policy.accrualMode === "ANNUAL_GRANT") {
    if (hireDate && year === hireYear) {
      const remaining = Math.max(0, 12 - firstFullMonthIndex(hireDate));
      return roundHalf((dpy * remaining) / 12);
    }
    return dpy;
  }

  // MONTHLY
  const curYear = today.getUTCFullYear();
  if (year > curYear) return 0;
  let endIdx: number;
  if (year < curYear) {
    endIdx = 12;
  } else {
    const lastDayOfMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
    ).getUTCDate();
    endIdx = today.getUTCMonth() + (today.getUTCDate() === lastDayOfMonth ? 1 : 0);
  }
  const startIdx = hireDate && year === hireYear ? firstFullMonthIndex(hireDate) : 0;
  return round1((dpy / 12) * Math.max(0, endIdx - startIdx));
}

// ── Balance computation ──────────────────────────────────────────────────

export type BalanceRequest = LeaveRange & {
  leaveType: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
};
export type BalanceAdjustment = { year: number; leaveType: string; days: number };

export type BalanceInput = {
  policies: PolicyMap;
  hireDate: Date | null;
  adjustments: BalanceAdjustment[];
  requests: BalanceRequest[];
  today: Date;
  holidays?: ReadonlySet<string>;
};

export type TypeBalance = {
  leaveType: string;
  year: number;
  unlimited: boolean;
  earned: number;
  carryover: number;
  adjustments: number;
  /** Approved days dated on/before today. */
  taken: number;
  /** Approved days dated after today. */
  upcoming: number;
  /** Pending days (reserved). */
  pending: number;
  /** taken + upcoming + pending. */
  used: number;
  /** earned + carryover + adjustments. */
  allowed: number;
  /** allowed - used; null when unlimited. May be negative (over-drawn). */
  available: number | null;
};

function usedInYear(
  input: BalanceInput,
  type: string,
  year: number,
): { taken: number; upcoming: number; pending: number } {
  let taken = 0;
  let upcoming = 0;
  let pending = 0;
  const todayMs = input.today.getTime();
  for (const r of input.requests) {
    if (r.leaveType !== type) continue;
    if (r.status !== "PENDING" && r.status !== "APPROVED") continue;
    for (const { date, weight } of dayWeights(r, input.holidays)) {
      if (date.getUTCFullYear() !== year) continue;
      if (r.status === "PENDING") pending += weight;
      else if (date.getTime() <= todayMs) taken += weight;
      else upcoming += weight;
    }
  }
  return { taken, upcoming, pending };
}

function adjustmentsFor(input: BalanceInput, type: string, year: number): number {
  return input.adjustments
    .filter((a) => a.leaveType === type && a.year === year)
    .reduce((s, a) => s + a.days, 0);
}

export function computeTypeBalance(input: BalanceInput, type: string, year: number): TypeBalance {
  const policy = policyFor(input.policies, type);
  const earned = earnedForYear(policy, year, input.hireDate, input.today);
  const adj = adjustmentsFor(input, type, year);
  const u = usedInYear(input, type, year);

  let carryover = 0;
  if (policy.carryoverMax > 0) {
    const prev = year - 1;
    const prevEarned = earnedForYear(policy, prev, input.hireDate, input.today);
    if (prevEarned > 0 || adjustmentsFor(input, type, prev) !== 0) {
      const pu = usedInYear(input, type, prev);
      const prevUnused =
        prevEarned + adjustmentsFor(input, type, prev) - (pu.taken + pu.upcoming + pu.pending);
      carryover = Math.min(policy.carryoverMax, Math.max(0, prevUnused));
    }
  }

  const used = u.taken + u.upcoming + u.pending;
  const allowed = earned + carryover + adj;
  return {
    leaveType: type,
    year,
    unlimited: policy.unlimited,
    earned: round1(earned),
    carryover: round1(carryover),
    adjustments: round1(adj),
    taken: u.taken,
    upcoming: u.upcoming,
    pending: u.pending,
    used,
    allowed: round1(allowed),
    available: policy.unlimited ? null : round1(allowed - used),
  };
}

export type YearBalances = {
  year: number;
  types: Record<string, TypeBalance>;
  totals: {
    /** Limited types only. */
    allowed: number;
    taken: number;
    upcoming: number;
    pending: number;
    used: number;
    available: number;
  };
};

export function computeBalances(input: BalanceInput, year: number): YearBalances {
  const types: Record<string, TypeBalance> = {};
  for (const t of LEAVE_TYPES) types[t] = computeTypeBalance(input, t, year);
  const totals = { allowed: 0, taken: 0, upcoming: 0, pending: 0, used: 0, available: 0 };
  for (const b of Object.values(types)) {
    if (b.unlimited) continue;
    totals.allowed += b.allowed;
    totals.taken += b.taken;
    totals.upcoming += b.upcoming;
    totals.pending += b.pending;
    totals.used += b.used;
    totals.available += b.available ?? 0;
  }
  for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] = round1(totals[k]);
  return { year, types, totals };
}

// ── Validation helpers used by server actions ────────────────────────────

/** Overlap against the employee's own PENDING/APPROVED requests. */
export function findOverlap<T extends LeaveRange & { id?: string; status: string }>(
  range: { startDate: Date; endDate: Date },
  existing: T[],
  excludeId?: string,
): T | null {
  return (
    existing.find(
      (r) =>
        r.id !== excludeId &&
        (r.status === "PENDING" || r.status === "APPROVED") &&
        rangesOverlap(range, r),
    ) ?? null
  );
}

/**
 * Would adding `range` (of `type`) overdraw the balance in any calendar year
 * it touches? `requests` must NOT already contain the candidate. Returns a
 * human message or null when fine.
 */
export function balanceShortfall(
  input: BalanceInput,
  type: string,
  range: LeaveRange,
): string | null {
  const policy = policyFor(input.policies, type);
  if (policy.unlimited) return null;
  for (const [year, days] of splitDaysByYear(range, input.holidays)) {
    const b = computeTypeBalance(input, type, year);
    const avail = b.available ?? 0;
    if (days > avail + 1e-9) {
      return `Not enough ${type.toLowerCase()} leave for ${year}: you have ${fmtDays(Math.max(0, avail))} available (pending requests included) but this request needs ${fmtDays(days)}.`;
    }
  }
  return null;
}

/** For approval: is the (already-counted) request's year balance < 0? */
export function overdrawnYears(input: BalanceInput, type: string, range: LeaveRange): number[] {
  const policy = policyFor(input.policies, type);
  if (policy.unlimited) return [];
  const out: number[] = [];
  for (const year of splitDaysByYear(range, input.holidays).keys()) {
    const b = computeTypeBalance(input, type, year);
    if ((b.available ?? 0) < -1e-9) out.push(year);
  }
  return out;
}

export function fmtDays(n: number): string {
  const v = round1(n);
  return `${v} day${v === 1 ? "" : "s"}`;
}
