"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fail, failFromUnknown, ok, type ActionResult } from "@/lib/action-result";
import { parseDateOnly } from "@/lib/time-rules";
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
      select: { employeeId: true, name: true },
    });
    if (!employee) return fail("That employee no longer exists.");
    const entries = await db.timeEntry.findMany({
      where: { employeeId: data.employeeId, date: { gte: from, lte: to } },
      orderBy: [{ date: "asc" }, { clockIn: "asc" }],
      select: {
        date: true,
        clockIn: true,
        clockOut: true,
        totalWorkMin: true,
        totalBreakMin: true,
        jobCode: true,
        approvalStatus: true,
      },
    });
    const workbook = entries.length
      ? buildEmployeeHoursWorkbook(employee, entries, data.from, data.to)
      : null;
    if (workbook)
      await audit({
        action: "hours.employee_export",
        resource: `Employee:${data.employeeId}`,
        actor,
        diff: {
          from: data.from,
          to: data.to,
          entryCount: entries.length,
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
