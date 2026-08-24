"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getPayrollSlipsForPeriod, payrollSlipsToCsv } from "@/server/queries/payroll-slip";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

/** Builds the payroll-slip CSV for download. */
export async function generatePayrollSlipCsv(
  periodId: string,
): Promise<ActionResult<{ csv: string }>> {
  await requireAdmin();
  try {
    const period = await db.payrollCalendar.findUnique({ where: { id: periodId } });
    if (!period) {
      return fail("That pay period no longer exists. Go back to payroll and pick another period.");
    }
    const slips = await getPayrollSlipsForPeriod(period.payPeriodStart, period.payPeriodEnd);
    const csv = payrollSlipsToCsv(
      period.title,
      period.payPeriodStart,
      period.payPeriodEnd,
      slips,
    );
    return ok({ csv });
  } catch (err) {
    return failFromUnknown(err);
  }
}
