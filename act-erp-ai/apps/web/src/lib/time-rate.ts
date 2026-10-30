import { Prisma } from "@prisma/client";
import type { Tx } from "@/server/time-core";

/**
 * Resolve the hourly rate to stamp on a TimeEntry at create/edit time.
 * Prefer assignment rate for the job code, then employee defaultHourlyRate.
 */
export async function resolveHourlyRate(
  tx: Tx,
  employeeId: string,
  jobCode: string,
): Promise<Prisma.Decimal | null> {
  const assignment = await tx.jobCodeAssignment.findFirst({
    where: { employeeId, jobCode: { code: jobCode, isActive: true } },
    select: { assignedRate: true },
  });
  if (assignment?.assignedRate != null) {
    const n = Number(assignment.assignedRate.toString());
    if (Number.isFinite(n) && n > 0) return new Prisma.Decimal(n.toFixed(2));
  }

  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    select: { defaultHourlyRate: true },
  });
  const fallback = Number(employee?.defaultHourlyRate?.toString() ?? NaN);
  return Number.isFinite(fallback) && fallback >= 0 ? new Prisma.Decimal(fallback.toFixed(2)) : null;
}

/**
 * Effective rate for display/export when TimeEntry.rate is null. Returns null
 * when neither value is a usable rate, so callers show a blank instead of
 * inventing a number.
 */
export function effectiveRate(
  entryRate: Prisma.Decimal | number | string | null | undefined,
  employeeDefault: Prisma.Decimal | number | string | null | undefined,
): number | null {
  for (const v of [entryRate, employeeDefault]) {
    if (v == null) continue;
    const n = Number(v.toString());
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}
