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
