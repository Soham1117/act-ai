"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";

export type PayrollNoteRow = { employeeId: string; employeeName: string; note: string };

const keySchema = z.object({ periodId: z.string().min(1), employeeId: z.string().min(1) });

async function periodOf(periodId: string) {
  return db.payrollCalendar.findUnique({
    where: { id: periodId },
    select: { payPeriodStart: true, payPeriodEnd: true },
  });
}

export async function listPayrollNotes(periodId: string): Promise<PayrollNoteRow[]> {
  await requireAdmin();
  const period = await periodOf(periodId);
  if (!period) return [];
  const rows = await db.payrollPeriodNote.findMany({
    where: { periodStart: period.payPeriodStart, periodEnd: period.payPeriodEnd },
    include: { employee: { select: { name: true } } },
    orderBy: { employee: { name: "asc" } },
  });
  return rows.map((r) => ({ employeeId: r.employeeId, employeeName: r.employee.name, note: r.note }));
}

/** An empty note removes it. */
export async function savePayrollNote(
  input: z.infer<typeof keySchema> & { note: string },
): Promise<ActionResult> {
  const admin = await requireAdmin();
  try {
    const { periodId, employeeId } = keySchema.parse(input);
    const note = z.string().trim().max(500).parse(input.note);
    const period = await periodOf(periodId);
    if (!period) return fail("That pay period no longer exists.");
    if (!note) {
      await db.payrollPeriodNote.deleteMany({
        where: { employeeId, periodStart: period.payPeriodStart, periodEnd: period.payPeriodEnd },
      });
    } else {
      await db.payrollPeriodNote.upsert({
        where: {
          employeeId_periodStart_periodEnd: {
            employeeId,
            periodStart: period.payPeriodStart,
            periodEnd: period.payPeriodEnd,
          },
        },
        create: {
          employeeId,
          periodStart: period.payPeriodStart,
          periodEnd: period.payPeriodEnd,
          note,
          updatedById: admin.id,
        },
        update: { note, updatedById: admin.id },
      });
    }
    await audit({
      action: "payroll.period_note",
      resource: `PayrollCalendar:${periodId}`,
      diff: { employeeId, removed: !note },
    });
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
