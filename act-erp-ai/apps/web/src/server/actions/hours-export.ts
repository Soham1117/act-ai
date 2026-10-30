"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { parseDateOnly } from "@/lib/time-rules";
import {
  DEFAULT_EXPORT_COLUMNS,
  buildHoursExportCsv,
  type HoursExportOptions,
} from "@/lib/hours-export";
import { executeHoursExportSchedule } from "@/server/hours-export-runner";
import { revalidatePath } from "next/cache";

const optionsSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  columns: z.array(z.string()).optional(),
  splitBy: z.enum(["NONE", "JOB_CODE", "RATE"]).default("NONE"),
  includeHeader: z.boolean().default(true),
  includeSalaried: z.boolean().default(true),
  approvedOnly: z.boolean().default(true),
  sortOrder: z.enum(["EMPLOYEE_ID", "NAME", "EXPORT_CODE"]).default("NAME"),
  templateId: z.string().optional(),
  departmentId: z.string().optional(),
});

async function loadEntries(from: Date, to: Date, departmentId?: string) {
  return db.timeEntry.findMany({
    where: {
      date: { gte: from, lte: to },
      ...(departmentId ? { employee: { departmentId } } : {}),
    },
    select: {
      id: true,
      employeeId: true,
      date: true,
      clockIn: true,
      totalWorkMin: true,
      jobCode: true,
      rate: true,
      source: true,
      approvalStatus: true,
      employee: {
        select: {
          employeeId: true,
          name: true,
          exportCode: true,
          defaultHourlyRate: true,
          compensationType: true,
          department: { select: { name: true } },
        },
      },
    },
    orderBy: [{ date: "asc" }, { clockIn: "asc" }],
  });
}

export async function generateHoursPeriodExport(
  input: z.infer<typeof optionsSchema>,
): Promise<ActionResult<{ csv: string; filename: string; rowHint: string }>> {
  const admin = await requireAdmin();
  try {
    const data = optionsSchema.parse(input);
    const from = parseDateOnly(data.from);
    const to = parseDateOnly(data.to);
    if (!from || !to) return fail("Enter a valid date range.");

    let options: HoursExportOptions = {
      columns: data.columns?.length ? data.columns : [...DEFAULT_EXPORT_COLUMNS],
      splitBy: data.splitBy,
      includeHeader: data.includeHeader,
      includeSalaried: data.includeSalaried,
      approvedOnly: data.approvedOnly,
      sortOrder: data.sortOrder,
      from: data.from,
      to: data.to,
    };

    if (data.templateId) {
      const tpl = await db.hoursExportTemplate.findUnique({ where: { id: data.templateId } });
      if (!tpl) return fail("That export template no longer exists.");
      options = {
        ...options,
        columns: tpl.columns,
        splitBy: tpl.splitBy,
        includeHeader: tpl.includeHeader,
        includeSalaried: tpl.includeSalaried,
        approvedOnly: tpl.approvedOnly,
        sortOrder: tpl.sortOrder,
      };
    }

    const entries = await loadEntries(from, to, data.departmentId || undefined);
    const csv = buildHoursExportCsv(entries, options);
    const filename = `hours-export-${data.from}_${data.to}.csv`;
    await audit({
      action: "hours.period_export",
      resource: `HoursExport:${data.from}:${data.to}`,
      diff: {
        actorId: admin.id,
        options,
        bytes: csv.length,
        entryCount: entries.length,
      },
    });
    return ok({
      csv,
      filename,
      rowHint: `${entries.length} source entries`,
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const saveTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  columns: z.array(z.string()).min(1),
  splitBy: z.enum(["NONE", "JOB_CODE", "RATE"]),
  includeHeader: z.boolean(),
  includeSalaried: z.boolean(),
  approvedOnly: z.boolean(),
  sortOrder: z.enum(["EMPLOYEE_ID", "NAME", "EXPORT_CODE"]),
  isDefault: z.boolean().optional(),
});

export async function saveHoursExportTemplate(
  input: z.infer<typeof saveTemplateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = saveTemplateSchema.parse(input);
    if (data.isDefault) {
      await db.hoursExportTemplate.updateMany({ data: { isDefault: false } });
    }
    const row = await db.hoursExportTemplate.create({
      data: {
        name: data.name,
        columns: data.columns,
        splitBy: data.splitBy,
        includeHeader: data.includeHeader,
        includeSalaried: data.includeSalaried,
        approvedOnly: data.approvedOnly,
        sortOrder: data.sortOrder,
        isDefault: !!data.isDefault,
        createdById: admin.id,
      },
    });
    revalidatePath("/admin/hours/period-export");
    return ok({ id: row.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const scheduleSchema = z.object({
  templateId: z.string().min(1),
  description: z.string().trim().min(1).max(120),
  weekday: z.number().int().min(0).max(6),
  minuteOfDay: z.number().int().min(0).max(1439).default(360),
  rangeDays: z.number().int().min(1).max(62).default(7),
});

export async function createHoursExportSchedule(
  input: z.infer<typeof scheduleSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = scheduleSchema.parse(input);
    const tpl = await db.hoursExportTemplate.findUnique({ where: { id: data.templateId } });
    if (!tpl) return fail("Choose a saved template first.");
    const row = await db.hoursExportSchedule.create({
      data: {
        templateId: data.templateId,
        description: data.description,
        weekday: data.weekday,
        minuteOfDay: data.minuteOfDay,
        rangeDays: data.rangeDays,
        createdById: admin.id,
      },
    });
    revalidatePath("/admin/hours/period-export");
    return ok({ id: row.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Admin "run now" — same path as cron (`executeHoursExportSchedule`). */
export async function runHoursExportScheduleNow(
  scheduleId: string,
): Promise<ActionResult<{ key: string }>> {
  await requireAdmin();
  try {
    const { key } = await executeHoursExportSchedule(scheduleId);
    revalidatePath("/admin/hours/period-export");
    return ok({ key });
  } catch (err) {
    return failFromUnknown(err);
  }
}

