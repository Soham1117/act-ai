/**
 * Pure helpers for the contract-worker (agency staff) module. No DB or
 * framework imports so they stay trivially unit-testable.
 *
 * All dates here are "date-only" values: UTC midnight of the business
 * (America/Chicago) calendar day, the same shape as Prisma `@db.Date`.
 */

/** Business ID prefix, e.g. CW-0001. */
export const CONTRACT_WORKER_ID_PREFIX = "CW-";

/** `formatContractWorkerId(7)` -> `CW-0007`. Numbers above 9999 just grow. */
export function formatContractWorkerId(n: number): string {
  return `${CONTRACT_WORKER_ID_PREFIX}${String(Math.max(0, Math.floor(n))).padStart(4, "0")}`;
}

/** Number part of a `CW-0007` style ID, or null when it doesn't match. */
export function parseContractWorkerNumber(id: string): number | null {
  const m = /^CW-(\d+)$/i.exec(id.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

/** Next free ID given the existing ones (highest number + 1; CW-0001 when none). */
export function nextContractWorkerIdFrom(existing: readonly string[]): string {
  let max = 0;
  for (const id of existing) {
    const n = parseContractWorkerNumber(id);
    if (n !== null && n > max) max = n;
  }
  return formatContractWorkerId(max + 1);
}

export type ContractWorkerEligibilityInput = {
  status: "ACTIVE" | "ENDED" | "INACTIVE";
  startDate: Date;
  endDate: Date | null;
};

/**
 * Can this worker clock in on the business day `today`?
 * ACTIVE, started on or before today, and not past the end date.
 */
export function isContractWorkerEligible(
  worker: ContractWorkerEligibilityInput,
  today: Date,
): boolean {
  if (worker.status !== "ACTIVE") return false;
  const t = today.getTime();
  if (worker.startDate.getTime() > t) return false;
  if (worker.endDate && worker.endDate.getTime() < t) return false;
  return true;
}

/** Why a worker can't clock in (user-facing), or null when eligible. */
export function contractWorkerIneligibleReason(
  worker: ContractWorkerEligibilityInput,
  today: Date,
): string | null {
  if (isContractWorkerEligible(worker, today)) return null;
  if (worker.status === "INACTIVE") {
    return "This worker is inactive. Please see an admin to reactivate them.";
  }
  if (worker.status !== "ACTIVE") {
    return "This contract has ended. Please see an admin.";
  }
  if (worker.startDate.getTime() > today.getTime()) {
    return "This contract has not started yet. Please see an admin.";
  }
  return "This contract has ended. Please see an admin.";
}

/** Number of Mon-Fri days after `from` up to and including `to` (0 when `to <= from`). */
export function businessDaysBetween(from: Date, to: Date): number {
  const DAY = 86_400_000;
  let count = 0;
  for (let t = from.getTime() + DAY; t <= to.getTime(); t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** True when the contract ends within `days` business days from `today` (and hasn't passed). */
export function isEndingSoon(endDate: Date | null, today: Date, days = 7): boolean {
  if (!endDate) return false;
  if (endDate.getTime() < today.getTime()) return false;
  return businessDaysBetween(today, endDate) <= days;
}

/** YYYY-MM-DD for a Prisma `@db.Date` / UTC-midnight date-only value. */
export function dateOnlyIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** One unpaid break centred in the shift; null when `breakMin` is 0. */
export function middleShiftBreak(clockIn: Date, clockOut: Date, breakMin: number) {
  if (breakMin <= 0) return null;
  const mid = (clockIn.getTime() + clockOut.getTime()) / 2;
  return {
    startTime: new Date(mid - (breakMin * 60_000) / 2),
    endTime: new Date(mid + (breakMin * 60_000) / 2),
  };
}

export type ContractAssignmentOffers = {
  /** Move startDate earlier to this YYYY-MM-DD. */
  shiftStartTo?: string;
  /** Move endDate later to this YYYY-MM-DD. */
  extendEndTo?: string;
  /** Set status to ACTIVE. */
  reactivate?: boolean;
};

export type ContractAssignmentOfferDefaults = {
  shiftStart: boolean;
  extendEnd: boolean;
  reactivate: boolean;
};

type AssignmentWorker = {
  startDate: Date;
  endDate: Date | null;
  status: "ACTIVE" | "INACTIVE" | "ENDED";
};

/**
 * What the admin UI should offer when adding hours on `entryDate` (date-only).
 * Defaults: date shifts on when offered; reactivate off.
 */
export function proposeContractAssignmentOffers(
  worker: AssignmentWorker,
  entryDate: Date,
): { offers: ContractAssignmentOffers; defaults: ContractAssignmentOfferDefaults } {
  const offers: ContractAssignmentOffers = {};
  const defaults: ContractAssignmentOfferDefaults = {
    shiftStart: false,
    extendEnd: false,
    reactivate: false,
  };
  const day = entryDate.getTime();
  if (worker.startDate.getTime() > day) {
    offers.shiftStartTo = dateOnlyIso(entryDate);
    defaults.shiftStart = true;
  }
  if (worker.endDate && worker.endDate.getTime() < day) {
    offers.extendEndTo = dateOnlyIso(entryDate);
    defaults.extendEnd = true;
  }
  if (worker.status === "INACTIVE" || worker.status === "ENDED") {
    offers.reactivate = true;
    defaults.reactivate = false;
  }
  return { offers, defaults };
}

/**
 * Apply only the offers the admin accepted. Returns the next assignment fields,
 * or an error if the entry date would still fall outside the window.
 */
export function applyContractAssignmentOffers(
  worker: AssignmentWorker,
  entryDate: Date,
  accepted: ContractAssignmentOffers,
): AssignmentWorker | { error: string } {
  let startDate = worker.startDate;
  let endDate = worker.endDate;
  let status = worker.status;

  if (accepted.shiftStartTo) {
    const next = new Date(`${accepted.shiftStartTo}T00:00:00.000Z`);
    if (Number.isNaN(next.getTime())) {
      return { error: "The proposed start date is not valid." };
    }
    if (next.getTime() > startDate.getTime()) {
      return { error: "Start date can only move earlier to cover the entry." };
    }
    // Only accept a shift that matches (or is still early enough for) the entry day.
    if (next.getTime() > entryDate.getTime()) {
      return { error: "The new start date is still after the entry date." };
    }
    startDate = next;
  }

  if (accepted.extendEndTo) {
    const next = new Date(`${accepted.extendEndTo}T00:00:00.000Z`);
    if (Number.isNaN(next.getTime())) {
      return { error: "The proposed end date is not valid." };
    }
    if (endDate && next.getTime() < endDate.getTime()) {
      return { error: "End date can only move later to cover the entry." };
    }
    if (next.getTime() < entryDate.getTime()) {
      return { error: "The new end date is still before the entry date." };
    }
    endDate = next;
  }

  if (accepted.reactivate) {
    status = "ACTIVE";
  }

  const day = entryDate.getTime();
  if (startDate.getTime() > day) {
    return {
      error:
        "This entry is before the assignment start date. Accept shifting the start date, or pick a later day.",
    };
  }
  if (endDate && endDate.getTime() < day) {
    return {
      error:
        "This entry is after the assignment end date. Accept extending the end date, or pick an earlier day.",
    };
  }

  return { startDate, endDate, status };
}
