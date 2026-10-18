import { db, businessYmd } from "./db";
import { JOB_CODE, PAYROLL_PERIOD_TITLE } from "./test-data";

/**
 * Make the base "E2E Pay Period" export-ready again: every ACTIVE employee gets
 * one approved shift inside it if they have none. Other specs create, delete and
 * edit people and time entries, so payroll-csv.spec.ts calls this first instead
 * of relying on what ran before it.
 */
export async function ensurePayrollReady() {
  const period = await db.payrollCalendar.findFirstOrThrow({ where: { title: PAYROLL_PERIOD_TITLE } });
  const day = new Date(`${businessYmd(55)}T00:00:00Z`);
  const need = await db.employee.findMany({
    where: {
      employmentStatus: "ACTIVE",
      timeEntries: {
        none: {
          approvalStatus: "APPROVED",
          date: { gte: period.payPeriodStart, lte: period.payPeriodEnd },
        },
      },
    },
    select: { id: true },
  });
  for (const e of need) {
    await db.timeEntry.create({
      data: {
        employeeId: e.id,
        date: day,
        clockIn: new Date(day.getTime() + 14 * 3600_000),
        clockOut: new Date(day.getTime() + 22 * 3600_000),
        totalWorkMin: 480,
        status: "APPROVED",
        jobCode: JOB_CODE.code,
        source: "MANUAL",
        approvalStatus: "APPROVED",
        approvalDate: new Date(),
      },
    });
  }
}
