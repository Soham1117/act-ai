import { db } from "@/lib/db";
import { derivePeriodStatus, validatePeriodDates } from "@/lib/payroll-period";

export const IMPORT_PERIOD_NOTE = "Created automatically from a paystub import.";

export type ImportPeriod = { start: string; end: string; payDate: string | null };
export type EnsuredPeriods = {
  created: { id: string; start: string; end: string }[];
  existing: number;
  skipped: { start: string; end: string; reason: string }[];
};

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * Makes sure a pay period exists for every date range printed on saved stubs,
 * so hours exports and the payroll calendar line up with the paystubs. An exact
 * match is reused; a range that only partly overlaps an existing period is
 * skipped and reported (it needs a human), never edited.
 */
export async function ensureImportPeriods(actorId: string, periods: ImportPeriod[]): Promise<EnsuredPeriods> {
  const unique = new Map<string, ImportPeriod>();
  for (const period of periods) {
    const key = `${period.start}|${period.end}`;
    const known = unique.get(key);
    if (!known || (!known.payDate && period.payDate)) unique.set(key, period);
  }
  const result: EnsuredPeriods = { created: [], existing: 0, skipped: [] };
  for (const period of [...unique.values()].sort((a, b) => a.start.localeCompare(b.start))) {
    const payDate = period.payDate ?? period.end;
    const check = validatePeriodDates(period.start, period.end, payDate);
    if (!check.ok) { result.skipped.push({ start: period.start, end: period.end, reason: check.error }); continue; }
    const start = day(period.start);
    const end = day(period.end);
    try {
      await db.$transaction(async (tx) => {
        // Same lock the manual create/edit actions use.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payroll-calendar-period-writes'))`;
        const overlaps = await tx.payrollCalendar.findMany({
          where: { payPeriodStart: { lte: end }, payPeriodEnd: { gte: start } },
          select: { id: true, title: true, payPeriodStart: true, payPeriodEnd: true },
        });
        if (overlaps.some((row) => row.payPeriodStart.getTime() === start.getTime() && row.payPeriodEnd.getTime() === end.getTime())) {
          result.existing++;
          return;
        }
        if (overlaps.length) {
          result.skipped.push({ start: period.start, end: period.end, reason: `Overlaps the existing period "${overlaps[0].title}". Adjust it on the Payroll page if the stub dates are right.` });
          return;
        }
        const created = await tx.payrollCalendar.create({
          data: {
            title: `Pay period ${period.start} to ${period.end}`,
            payPeriodStart: start,
            payPeriodEnd: end,
            payDate: day(payDate),
            status: derivePeriodStatus(start, end),
            notes: IMPORT_PERIOD_NOTE,
            createdById: actorId,
          },
        });
        await tx.auditLog.create({ data: { actorId, action: "payroll.period.create", resource: `PayrollCalendar:${created.id}`, diff: { start: period.start, end: period.end, source: "paystub-import" } } });
        result.created.push({ id: created.id, start: period.start, end: period.end });
      });
    } catch {
      result.skipped.push({ start: period.start, end: period.end, reason: "Could not create this period. Create it on the Payroll page." });
    }
  }
  return result;
}
