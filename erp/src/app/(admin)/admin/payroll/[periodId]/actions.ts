"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getPayrollSlipsForPeriod, payrollSlipsToCsv } from "@/server/queries/payroll-slip";

/** Builds the payroll-slip CSV for download. */
export async function generatePayrollSlipCsv(periodId: string): Promise<string> {
  await requireAdmin();
  const period = await db.payrollCalendar.findUnique({ where: { id: periodId } });
  if (!period) throw new Error("Pay period not found");
  const slips = await getPayrollSlipsForPeriod(period.payPeriodStart, period.payPeriodEnd);
  return payrollSlipsToCsv(period.title, period.payPeriodStart, period.payPeriodEnd, slips);
}
