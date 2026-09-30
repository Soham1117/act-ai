/**
 * Account access levels.
 *
 *  FULL       normal use
 *  READ_ONLY  can sign in and VIEW their own data (payroll, documents,
 *             benefits, details) but cannot create or change anything.
 *             Applies to terminated employees for TERMINATION_GRACE_DAYS after
 *             their termination date, and to new hires awaiting admin review.
 *  NONE       cannot sign in (terminated longer than the grace window).
 *
 * Admins are always FULL. Employee records and documents are never deleted by
 * this — only the ability to sign in expires.
 */
export const TERMINATION_GRACE_DAYS = 60;

export type AccessLevel = "FULL" | "READ_ONLY" | "NONE";

type AccessInput = {
  role: "ADMIN" | "EMPLOYEE";
  employee: {
    employmentStatus: "ACTIVE" | "ON_LEAVE" | "TERMINATED" | "PENDING_REVIEW";
    terminationDate: Date | null;
    updatedAt?: Date;
  } | null;
};

export function accessLevelFor(input: AccessInput, now: Date = new Date()): AccessLevel {
  if (input.role === "ADMIN") return "FULL";
  const e = input.employee;
  if (!e) return "FULL"; // user with no employee record (system account)
  if (e.employmentStatus === "PENDING_REVIEW") return "READ_ONLY";
  if (e.employmentStatus !== "TERMINATED") return "FULL";
  const since = e.terminationDate ?? e.updatedAt ?? now;
  const days = (now.getTime() - since.getTime()) / 86_400_000;
  return days <= TERMINATION_GRACE_DAYS ? "READ_ONLY" : "NONE";
}

export const READ_ONLY_MESSAGE =
  "Your account is read-only. You can view your records but can't make changes.";
