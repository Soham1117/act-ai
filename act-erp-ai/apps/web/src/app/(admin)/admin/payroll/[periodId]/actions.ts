"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  getPayrollReadinessForPeriod,
  getPayrollSlipsForPeriod,
  payrollSlipsToCsv,
} from "@/server/queries/payroll-slip";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

/** Builds the payroll-slip CSV for download. */
export async function generatePayrollSlipCsv(
  periodId: string,
  overrideReason?: string,
): Promise<ActionResult<{ csv: string }>> {
  await requireAdmin();
  try {
    const period = await db.payrollCalendar.findUnique({ where: { id: periodId } });
    if (!period) {
      return fail("That pay period no longer exists. Go back to payroll and pick another period.");
    }
    const reason = overrideReason?.trim() ?? "";
    const result = await db.$transaction(
      async (tx) => {
        const readiness = await getPayrollReadinessForPeriod(
          period.payPeriodStart,
          period.payPeriodEnd,
          tx,
        );
        if (readiness.blocking && reason.length < 10) return { readiness, slips: null };
        const slips = await getPayrollSlipsForPeriod(
          period.payPeriodStart,
          period.payPeriodEnd,
          tx,
        );
        return { readiness, slips };
      },
      { isolationLevel: "RepeatableRead" },
    );
    if (!result.slips) {
      return fail(
        "Payroll has unresolved time exceptions. Review the readiness list, or enter an override reason of at least 10 characters.",
      );
    }
    const csv = payrollSlipsToCsv(
      period.title,
      period.payPeriodStart,
      period.payPeriodEnd,
      result.slips,
    );
    if (result.readiness.blocking) {
      await audit({
        action: "payroll.export_override",
        resource: `PayrollCalendar:${period.id}`,
        diff: {
          periodId: period.id,
          title: period.title,
          payPeriodStart: period.payPeriodStart.toISOString().slice(0, 10),
          payPeriodEnd: period.payPeriodEnd.toISOString().slice(0, 10),
          reason,
          exceptionSummary: result.readiness.summary,
          affectedEmployees: result.readiness.employees.filter((employee) => employee.exceptions.length > 0)
            .length,
        },
      });
    }
    return ok({ csv });
  } catch (err) {
    return failFromUnknown(err);
  }
}
