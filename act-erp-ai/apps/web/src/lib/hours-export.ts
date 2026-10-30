import { Prisma } from "@prisma/client";
import { allocateWeeklyOvertime, csvRow } from "@/lib/payroll-overtime";
import { dateOnlyToString } from "@/lib/time-rules";
import { effectiveRate } from "@/lib/time-rate";

export const EXPORT_COLUMN_KEYS = [
  "exportCode",
  "employeeId",
  "name",
  "department",
  "date",
  "jobCode",
  "rate",
  "regularHours",
  "otHours",
  "totalHours",
  "source",
  "approvalStatus",
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMN_KEYS)[number];

export const DEFAULT_EXPORT_COLUMNS: ExportColumnKey[] = [
  "exportCode",
  "employeeId",
  "name",
  "department",
  "date",
  "jobCode",
  "rate",
  "regularHours",
  "otHours",
  "totalHours",
];

export type HoursExportEntry = {
  id: string;
  employeeId: string;
  date: Date;
  clockIn: Date;
  totalWorkMin: number;
  jobCode: string;
  rate: Prisma.Decimal | null;
  source: string;
  approvalStatus: string;
  employee: {
    employeeId: string;
    name: string;
    exportCode: string | null;
    defaultHourlyRate: Prisma.Decimal;
    compensationType: string;
    department: { name: string } | null;
  };
};

export type HoursExportOptions = {
  columns: string[];
  splitBy: "NONE" | "JOB_CODE" | "RATE";
  includeHeader: boolean;
  includeSalaried: boolean;
  approvedOnly: boolean;
  sortOrder: "EMPLOYEE_ID" | "NAME" | "EXPORT_CODE";
  from: string;
  to: string;
};

type FlatRow = {
  exportCode: string;
  employeeId: string;
  name: string;
  department: string;
  date: string;
  jobCode: string;
  rate: number;
  regularHours: number;
  otHours: number;
  totalHours: number;
  source: string;
  approvalStatus: string;
  sortKey: string;
};

function hours(min: number): number {
  return Math.round((min / 60) * 100) / 100;
}

function groupKey(e: HoursExportEntry, splitBy: HoursExportOptions["splitBy"]): string {
  const day = dateOnlyToString(e.date);
  const rate = effectiveRate(e.rate, e.employee.defaultHourlyRate);
  if (splitBy === "JOB_CODE") return `${e.employeeId}|${day}|${e.jobCode}`;
  if (splitBy === "RATE") return `${e.employeeId}|${day}|${rate.toFixed(2)}`;
  return `${e.employeeId}|${day}|${e.jobCode}|${rate.toFixed(2)}|${e.id}`;
}

/** Assign OT minutes to entries (latest first) using weekly allocator totals. */
function otSplitByEntry(
  empEntries: HoursExportEntry[],
  from: string,
  to: string,
): Map<string, { regular: number; ot: number }> {
  const sorted = [...empEntries].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.clockIn.getTime() - b.clockIn.getTime(),
  );
  const alloc = allocateWeeklyOvertime(
    sorted.map((e) => ({
      date: dateOnlyToString(e.date),
      clockIn: e.clockIn.getTime(),
      minutes: e.totalWorkMin,
    })),
    from,
    to,
  );
  const out = new Map<string, { regular: number; ot: number }>();
  let otLeft = alloc.overtimeMin;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i]!;
    const take = Math.min(e.totalWorkMin, otLeft);
    out.set(e.id, { regular: e.totalWorkMin - take, ot: take });
    otLeft -= take;
  }
  return out;
}

export function buildHoursExportCsv(
  entries: HoursExportEntry[],
  options: HoursExportOptions,
): string {
  let list = entries.filter((e) => e.totalWorkMin > 0);
  if (options.approvedOnly) list = list.filter((e) => e.approvalStatus === "APPROVED");
  if (!options.includeSalaried) {
    list = list.filter((e) => e.employee.compensationType === "HOURLY_RATE");
  }

  const byEmployee = new Map<string, HoursExportEntry[]>();
  for (const e of list) {
    const arr = byEmployee.get(e.employeeId) ?? [];
    arr.push(e);
    byEmployee.set(e.employeeId, arr);
  }
  const otByEntryId = new Map<string, { regular: number; ot: number }>();
  for (const [, empEntries] of byEmployee) {
    for (const [id, split] of otSplitByEntry(empEntries, options.from, options.to)) {
      otByEntryId.set(id, split);
    }
  }

  const buckets = new Map<string, FlatRow>();
  for (const e of list) {
    const day = dateOnlyToString(e.date);
    if (day < options.from || day > options.to) continue;
    const key = groupKey(e, options.splitBy);
    const rate = effectiveRate(e.rate, e.employee.defaultHourlyRate);
    const split = otByEntryId.get(e.id) ?? { regular: e.totalWorkMin, ot: 0 };
    const existing = buckets.get(key);
    if (existing && options.splitBy !== "NONE") {
      const regMin = Math.round(existing.regularHours * 60) + split.regular;
      const otMin = Math.round(existing.otHours * 60) + split.ot;
      const totMin = Math.round(existing.totalHours * 60) + e.totalWorkMin;
      existing.regularHours = hours(regMin);
      existing.otHours = hours(otMin);
      existing.totalHours = hours(totMin);
      continue;
    }
    const sortKey =
      options.sortOrder === "EMPLOYEE_ID"
        ? e.employee.employeeId
        : options.sortOrder === "EXPORT_CODE"
          ? (e.employee.exportCode ?? e.employee.employeeId)
          : e.employee.name;
    buckets.set(key, {
      exportCode: e.employee.exportCode ?? "",
      employeeId: e.employee.employeeId,
      name: e.employee.name,
      department: e.employee.department?.name ?? "",
      date: day,
      jobCode: e.jobCode,
      rate,
      regularHours: hours(split.regular),
      otHours: hours(split.ot),
      totalHours: hours(e.totalWorkMin),
      source: e.source,
      approvalStatus: e.approvalStatus,
      sortKey,
    });
  }

  const rows = [...buckets.values()].sort((a, b) => {
    const c = a.sortKey.localeCompare(b.sortKey);
    if (c !== 0) return c;
    return a.date.localeCompare(b.date) || a.jobCode.localeCompare(b.jobCode);
  });

  const cols = options.columns.filter((c): c is ExportColumnKey =>
    (EXPORT_COLUMN_KEYS as readonly string[]).includes(c),
  );
  const useCols = cols.length ? cols : DEFAULT_EXPORT_COLUMNS;
  const lines: string[] = [];
  if (options.includeHeader) lines.push(csvRow([...useCols]));
  for (const r of rows) {
    lines.push(csvRow(useCols.map((c) => r[c])));
  }
  return `${lines.join("\n")}${lines.length ? "\n" : ""}`;
}
