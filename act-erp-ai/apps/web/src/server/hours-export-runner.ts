import { db } from "@/lib/db";
import { buildHoursExportCsv } from "@/lib/hours-export";
import { loadHoursExportEntries } from "@/server/hours-export-data";
import { uploadFile } from "@/lib/storage";
import { BUSINESS_TZ } from "@/lib/time-rules";

function chicagoClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const v = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[v("weekday")] ?? 0;
  const hour = Number(v("hour")) % 24;
  const minute = Number(v("minute"));
  return {
    weekday,
    minuteOfDay: hour * 60 + minute,
    dateKey: `${v("year")}-${v("month")}-${v("day")}`,
  };
}

function rangeEndingYesterday(rangeDays: number, now = new Date()) {
  const chicago = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // en-CA → YYYY-MM-DD
  const [y, m, d] = chicago.split("-").map(Number) as [number, number, number];
  const to = new Date(Date.UTC(y, m - 1, d));
  to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (rangeDays - 1));
  return {
    from,
    to,
    fromStr: from.toISOString().slice(0, 10),
    toStr: to.toISOString().slice(0, 10),
  };
}

/** Upload one schedule's CSV to S3. No auth — for cron + admin "run now". */
export async function executeHoursExportSchedule(scheduleId: string): Promise<{ key: string }> {
  const schedule = await db.hoursExportSchedule.findUnique({
    where: { id: scheduleId },
    include: { template: true },
  });
  if (!schedule) throw new Error("Schedule not found.");
  if (!schedule.enabled) throw new Error("Schedule is disabled.");

  const { fromStr, toStr } = rangeEndingYesterday(schedule.rangeDays);
  const entries = await loadHoursExportEntries(fromStr, toStr);
  const csv = buildHoursExportCsv(entries, {
    columns: schedule.template.columns,
    splitBy: schedule.template.splitBy,
    includeHeader: schedule.template.includeHeader,
    includeSalaried: schedule.template.includeSalaried,
    approvedOnly: schedule.template.approvedOnly,
    sortOrder: schedule.template.sortOrder,
    from: fromStr,
    to: toStr,
  });
  const path = `hours-exports/${fromStr}_${toStr}_${schedule.id}.csv`;
  await uploadFile("payroll", path, Buffer.from(csv, "utf8"), {
    contentType: "text/csv; charset=utf-8",
  });
  await db.hoursExportSchedule.update({
    where: { id: schedule.id },
    data: { lastRunAt: new Date(), lastError: null },
  });
  return { key: path };
}

/**
 * Due schedules: enabled, matching Chicago weekday, from minuteOfDay up to an
 * hour after it, and not already run today (Chicago).
 */
export async function listDueHoursExportSchedules(now = new Date()) {
  const clock = chicagoClock(now);
  const schedules = await db.hoursExportSchedule.findMany({
    where: { enabled: true, weekday: clock.weekday },
    include: { template: true },
  });
  return schedules.filter((s) => {
    // Never before the scheduled minute (approvals made overnight must be in),
    // and up to an hour after so one missed cron tick does not skip the week.
    const since = clock.minuteOfDay - s.minuteOfDay;
    if (since < 0 || since >= 60) return false;
    if (!s.lastRunAt) return true;
    return chicagoClock(s.lastRunAt).dateKey !== clock.dateKey;
  });
}

export async function runDueHoursExportSchedules(now = new Date()) {
  const due = await listDueHoursExportSchedules(now);
  const results: Array<{ id: string; ok: boolean; key?: string; error?: string }> = [];
  for (const s of due) {
    try {
      const { key } = await executeHoursExportSchedule(s.id);
      results.push({ id: s.id, ok: true, key });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.hoursExportSchedule.update({
        where: { id: s.id },
        data: { lastError: message.slice(0, 2000) },
      });
      results.push({ id: s.id, ok: false, error: message });
    }
  }
  return results;
}
