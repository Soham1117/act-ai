import type { Prisma, TimeBreak, TimeEntry } from "@prisma/client";
import { addDaysDateOnly, businessLocalToDate, dateOnlyToString, ADMIN_MAX_SHIFT_MS } from "@/lib/time-rules";

/** Include the entry version and every break so an intervening punch invalidates a draft. */
export function proposalEntrySnapshot(entry: TimeEntry & { breaks: TimeBreak[] }): Prisma.JsonObject {
  const { breaks, ...fields } = entry;
  return JSON.parse(JSON.stringify({
    ...fields,
    breaks: [...breaks].sort((a, b) => a.id.localeCompare(b.id)),
  })) as Prisma.JsonObject;
}

/** PostgreSQL JSONB does not preserve object key order. */
export function snapshotsMatch(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
    }
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

type ProposalSchedule = {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  updatedAt: Date;
};

/** Refuse missing, ambiguous, future or implausible schedule evidence. Never infer a break. */
export function scheduledClockOut(
  entry: { date: Date; clockIn: Date },
  schedules: ProposalSchedule[],
  now: Date,
): { clockOut: Date; scheduleId: string; scheduleUpdatedAt: string } | null {
  const matching = schedules.filter((s) => dateOnlyToString(s.date) === dateOnlyToString(entry.date));
  if (matching.length !== 1) return null;
  const schedule = matching[0]!;
  const start = businessLocalToDate(`${dateOnlyToString(schedule.date)}T${schedule.startTime}`);
  const endDate = schedule.endTime <= schedule.startTime ? addDaysDateOnly(schedule.date, 1) : schedule.date;
  const end = businessLocalToDate(`${dateOnlyToString(endDate)}T${schedule.endTime}`);
  if (!start || !end || schedule.startTime === schedule.endTime) return null;
  const elapsed = end.getTime() - entry.clockIn.getTime();
  if (entry.clockIn < new Date(start.getTime() - 4 * 3_600_000) || entry.clockIn >= end) return null;
  if (elapsed <= 0 || elapsed > ADMIN_MAX_SHIFT_MS || end > now) return null;
  return { clockOut: end, scheduleId: schedule.id, scheduleUpdatedAt: schedule.updatedAt.toISOString() };
}
