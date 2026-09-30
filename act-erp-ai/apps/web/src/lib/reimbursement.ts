/**
 * Pure reimbursement rules (no DB) so they are unit-testable and shared by the
 * server actions and the admin UI.
 */

export type ReimbursementStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "PAID";

/** Allowed admin review transitions. PAID is terminal; REJECTED only leaves via an audited "reopen". */
export const REIMBURSEMENT_TRANSITIONS: Record<ReimbursementStatus, ReimbursementStatus[]> = {
  PENDING: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["PAID", "REJECTED"],
  PAID: [],
  REJECTED: [],
};

export function canTransition(from: ReimbursementStatus, to: ReimbursementStatus): boolean {
  return REIMBURSEMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: ReimbursementStatus): ReimbursementStatus[] {
  return REIMBURSEMENT_TRANSITIONS[from] ?? [];
}

/** Only a rejected claim can be reopened (back to PENDING). */
export function canReopen(from: ReimbursementStatus): boolean {
  return from === "REJECTED";
}

export const MAX_REIMBURSEMENT_AMOUNT = 50_000;
export const MAX_RECEIPTS = 5;

export type Check = { ok: true } | { ok: false; error: string };

export function validateClaimAmount(amount: number): Check {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter an amount greater than $0.00." };
  }
  if (amount > MAX_REIMBURSEMENT_AMOUNT) {
    return {
      ok: false,
      error: `Claims over $${MAX_REIMBURSEMENT_AMOUNT.toLocaleString("en-US")} need to go through HR directly.`,
    };
  }
  // At most two decimal places.
  if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
    return { ok: false, error: "Amounts can have at most two decimal places." };
  }
  return { ok: true };
}

/** Paid amount must be > 0 and <= the claim amount; a partial payment needs a note. */
export function validatePaidAmount(paid: number, amount: number, note?: string | null): Check {
  if (!Number.isFinite(paid) || paid <= 0) {
    return { ok: false, error: "The paid amount must be greater than $0.00." };
  }
  if (paid > amount + 1e-9) {
    return { ok: false, error: "The paid amount can't be more than the claimed amount." };
  }
  if (paid < amount - 1e-9 && !(note && note.trim())) {
    return { ok: false, error: "Add a note explaining why this is a partial payment." };
  }
  return { ok: true };
}

/**
 * [start, end) instants of the current calendar year in the business timezone
 * (America/Chicago). Jan 1 is always standard time there (UTC-6), so midnight
 * Jan 1 local is 06:00 UTC.
 */
export function businessYearRange(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1, 6, 0, 0)),
    end: new Date(Date.UTC(year + 1, 0, 1, 6, 0, 0)),
  };
}
