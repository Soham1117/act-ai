import { db } from "@/lib/db";
import { businessDateString } from "@/lib/business-time";
import { derivePeriodStatus } from "@/lib/payroll-period";
import { planNextPeriods } from "@/lib/payroll-period-auto";

export const AUTO_PERIOD_NOTE = "Created automatically (next biweekly pay period).";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const key = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Keeps the pay calendar one period ahead so the payroll workbook and hours
 * export always have the current and next period to pick. Safe to call on every
 * page load: it only writes when a period is missing, never edits one, and
 * skips any range that overlaps something that already exists.
 */
export async function ensureUpcomingPayrollPeriods(): Promise<number> {
  try {
    const latest = await db.payrollCalendar.findFirst({ orderBy: { payPeriodEnd: "desc" } });
    if (!latest) return 0;
    const planned = planNextPeriods(
      { start: key(latest.payPeriodStart), end: key(latest.payPeriodEnd), payDate: key(latest.payDate) },
      businessDateString(),
    );
    if (planned.length === 0) return 0;

    return await db.$transaction(async (tx) => {
      // Same lock the manual create/edit actions use.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payroll-calendar-period-writes'))`;
      let created = 0;
      for (const p of planned) {
        const start = day(p.start);
        const end = day(p.end);
        const overlap = await tx.payrollCalendar.findFirst({
          where: { payPeriodStart: { lte: end }, payPeriodEnd: { gte: start } },
          select: { id: true },
        });
        if (overlap) continue;
        const row = await tx.payrollCalendar.create({
          data: {
            title: p.title,
            payPeriodStart: start,
            payPeriodEnd: end,
            payDate: day(p.payDate),
            status: derivePeriodStatus(start, end),
            notes: AUTO_PERIOD_NOTE,
            createdById: latest.createdById,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: latest.createdById,
            action: "payroll.period.auto_create",
            resource: `PayrollCalendar:${row.id}`,
            diff: { start: p.start, end: p.end, payDate: p.payDate },
          },
        });
        created += 1;
      }
      return created;
    });
  } catch (err) {
    // Never break the page this runs on.
    console.error("ensureUpcomingPayrollPeriods failed", err);
    return 0;
  }
}
