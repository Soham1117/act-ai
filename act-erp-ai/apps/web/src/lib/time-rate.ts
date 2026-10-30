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
): Promise<Prisma.Decimal> {
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
  const fallback = Number(employee?.defaultHourlyRate?.toString() ?? 25);
  return new Prisma.Decimal((Number.isFinite(fallback) && fallback >= 0 ? fallback : 25).toFixed(2));
}

/** Effective rate for display/export when TimeEntry.rate is null. */
export function effectiveRate(
  entryRate: Prisma.Decimal | number | string | null | undefined,
  employeeDefault: Prisma.Decimal | number | string | null | undefined,
): number {
  const a = entryRate == null ? NaN : Number(entryRate.toString());
  if (Number.isFinite(a) && a >= 0) return a;
  const b = employeeDefault == null ? NaN : Number(employeeDefault.toString());
  if (Number.isFinite(b) && b >= 0) return b;
  return 25;
}
