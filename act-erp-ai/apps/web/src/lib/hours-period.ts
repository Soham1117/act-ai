import { db } from "@/lib/db";
import { businessDateOnly, formatDateOnly } from "@/lib/format";
import {
  addDaysDateOnly,
  dateOnlyToString,
  parseDateOnly,
  startOfBusinessWeek,
} from "@/lib/time-rules";
import { effectivePeriodStatus } from "@/lib/payroll-period";

export type PeriodPreset = {
  id: string;
  label: string;
  from: string;
  to: string;
};

/** Current business week + recent/current payroll periods for Hours filters. */
export async function loadHoursPeriodPresets(): Promise<PeriodPreset[]> {
  const today = businessDateOnly();
  const weekStart = startOfBusinessWeek(today);
  const weekEnd = addDaysDateOnly(weekStart, 6);
  const presets: PeriodPreset[] = [
    {
      id: "open-week",
      label: "Open week",
      from: dateOnlyToString(weekStart),
      to: dateOnlyToString(weekEnd),
    },
  ];

  const periods = await db.payrollCalendar.findMany({
    orderBy: { payDate: "desc" },
    take: 8,
  });
  for (const p of periods) {
    const status = effectivePeriodStatus(p.status, p.payPeriodStart, p.payPeriodEnd);
    presets.push({
      id: p.id,
      label: `${p.title} (${status})`,
      from: dateOnlyToString(p.payPeriodStart),
      to: dateOnlyToString(p.payPeriodEnd),
    });
  }
  return presets;
}

export function resolveHoursRange(
  fromRaw: string | undefined,
  toRaw: string | undefined,
): { from: Date; to: Date; fromStr: string; toStr: string } {
  const today = businessDateOnly();
  const weekStart = startOfBusinessWeek(today);
  const fromParsed = parseDateOnly(fromRaw ?? "");
  const toParsed = parseDateOnly(toRaw ?? "");
  const from = fromParsed ?? weekStart;
  const to = toParsed ?? addDaysDateOnly(weekStart, 6);
  const rangeFrom = from <= to ? from : to;
  const rangeTo = from <= to ? to : from;
  return {
    from: rangeFrom,
    to: rangeTo,
    fromStr: dateOnlyToString(rangeFrom),
    toStr: dateOnlyToString(rangeTo),
  };
}

export { formatDateOnly };
