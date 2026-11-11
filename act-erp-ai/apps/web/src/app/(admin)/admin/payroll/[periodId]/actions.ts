"use server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getPayrollReadinessForPeriod } from "@/server/queries/payroll-slip";
import { loadPayrollWorkbook } from "@/server/payroll-workbook-data";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

/** Builds the period's approved hours as a Period (Detail) workbook for download. */
export async function generatePayrollSlipWorkbook(
  periodId: string,
  overrideReason?: string,
): Promise<ActionResult<{ xlsx: string; filename: string }>> {
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
        if (readiness.blocking && reason.length < 10) return { readiness, allowed: false };
        return { readiness, allowed: true };
      },
      { isolationLevel: "RepeatableRead" },
    );
    if (!result.allowed) {
      return fail(
        "Payroll has unresolved time exceptions. Review the readiness list, or enter an override reason of at least 10 characters.",
      );
    }
    const workbook = await loadPayrollWorkbook(period.id, 1, { approvedOnly: true });
    if (!workbook) {
      return fail("That pay period no longer exists. Go back to payroll and pick another period.");
    }
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
    return ok({ xlsx: workbook.xlsx.toString("base64"), filename: workbook.filename });
  } catch (err) {
    return failFromUnknown(err);
  }
}
