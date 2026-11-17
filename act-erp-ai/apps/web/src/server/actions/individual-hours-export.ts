"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fail, failFromUnknown, ok, type ActionResult } from "@/lib/action-result";
import { dateOnlyToString, parseDateOnly } from "@/lib/time-rules";
import { isoWeekStart } from "@/lib/payroll-overtime";
import { buildEmployeeHoursWorkbook } from "@/lib/employee-hours-workbook";

const schema = z.object({
  employeeId: z.string().min(1),
  from: z.string(),
  to: z.string(),
});

export async function exportIndividualEmployeeHours(
  input: z.input<typeof schema>,
): Promise<ActionResult<{ xlsx: string | null; filename: string }>> {
  const actor = await requireAdmin();
  try {
    const data = schema.parse(input);
    const from = parseDateOnly(data.from);
    const to = parseDateOnly(data.to);
    if (!from || !to || from > to) return fail("Choose a valid date range.");
    const employee = await db.employee.findUnique({
      where: { id: data.employeeId },
      select: { employeeId: true, name: true, compensationType: true },
    });
    if (!employee) return fail("That employee no longer exists.");
    // From the Monday of the first week, so weekly overtime counts earlier days.
    const weekStart = parseDateOnly(isoWeekStart(data.from))!;
    const entries = await db.timeEntry.findMany({
      where: { employeeId: data.employeeId, date: { gte: weekStart, lte: to } },
      orderBy: [{ date: "asc" }, { clockIn: "asc" }],
      select: { id: true, date: true, clockIn: true, clockOut: true, totalWorkMin: true, jobCode: true, approvalStatus: true },
    });
    const inRange = entries.filter((e) => e.date >= from).length;
    const workbook = inRange
      ? buildEmployeeHoursWorkbook(
          { name: employee.name, salaried: employee.compensationType !== "HOURLY_RATE" },
          entries.map((e) => ({
            id: e.id,
            employeeId: data.employeeId,
            employeeName: employee.name,
            date: dateOnlyToString(e.date),
            clockIn: e.clockIn.getTime(),
            clockOut: e.clockOut?.getTime() ?? null,
            totalWorkMin: e.totalWorkMin,
            jobCode: e.jobCode,
            approvalStatus: e.approvalStatus,
          })),
          data.from,
          data.to,
        )
      : null;
    if (workbook)
      await audit({
        action: "hours.employee_export",
        resource: `Employee:${data.employeeId}`,
        actor,
        diff: {
          from: data.from,
          to: data.to,
          entryCount: inRange,
          bytes: workbook.length,
        },
      });
    return ok({
      xlsx: workbook?.toString("base64") ?? null,
      filename: `employee-hours-${employee.employeeId}-${data.from}-to-${data.to}.xlsx`,
    });
  } catch (error) {
    return failFromUnknown(error);
  }
}
