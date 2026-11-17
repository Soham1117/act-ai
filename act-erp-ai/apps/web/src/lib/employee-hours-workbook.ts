import {
  buildPeriodSheet,
  buildWorkbookXlsx,
  LEAVE_COLUMNS,
  type SheetModel,
  type SheetRowModel,
  type WorkbookEntry,
} from "@/lib/payroll-workbook";
import { BUSINESS_TZ } from "@/lib/time-rules";
import { splitEntryOvertime } from "@/lib/payroll-overtime";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const mdy = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${m}/${d}/${y}`;
};
const clockTime = (ms: number) =>
  new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour: "numeric", minute: "2-digit" }).format(ms);
const weekday = (iso: string) => DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]!;

/**
 * One row per person per worked day in the range: hours, regular/overtime
 * split, leave. Overtime is worked out per person.
 */
export function buildDailySheet(entries: WorkbookEntry[], from: string, to: string): SheetModel {
  const leaveCodes = new Set(LEAVE_COLUMNS.map((c) => c.code));
  const byPerson = new Map<string, WorkbookEntry[]>();
  for (const e of entries) {
    if (e.approvalStatus === "REJECTED") continue;
    byPerson.set(e.employeeId, [...(byPerson.get(e.employeeId) ?? []), e]);
  }
  const people = [...byPerson.values()].sort((a, b) => a[0]!.employeeName.localeCompare(b[0]!.employeeName));

  const D = [5, 6, 7, 8, 9];
  const rows: SheetRowModel[] = [
    { cells: ["Daily Times"], style: "title" },
    { cells: [`${mdy(from)} to ${mdy(to)}`], style: "subtitle" },
    { cells: ["Name", "Date", "Day", "Clock In", "Clock Out", "Worked", "Regular", "Overtime 1", "Leave", "Total"], style: "header" },
  ];
  const grand = { work: 0, regular: 0, overtime: 0, leave: 0 };
  for (const list of people) {
    const split = splitEntryOvertime(
      list
        .filter((e) => !leaveCodes.has(e.jobCode))
        .map((e) => ({ id: e.id, date: e.date, clockIn: e.clockIn, minutes: e.totalWorkMin })),
      from,
      to,
    );
    const days = new Map<string, { work: number; regular: number; overtime: number; leave: number } & { first: number; last: number | null }>();
    for (const e of list) {
      if (e.date < from || e.date > to) continue;
      const d = days.get(e.date) ?? { work: 0, regular: 0, overtime: 0, leave: 0, first: e.clockIn, last: e.clockOut ?? null };
      d.first = Math.min(d.first, e.clockIn);
      // A day with any open shift has no clock out yet.
      d.last = e.clockOut == null || d.last === null ? null : Math.max(d.last, e.clockOut);
      if (leaveCodes.has(e.jobCode)) d.leave += e.totalWorkMin;
      else {
        const s = split.get(e.id) ?? { regularMin: e.totalWorkMin, overtimeMin: 0 };
        d.work += e.totalWorkMin;
        d.regular += s.regularMin;
        d.overtime += s.overtimeMin;
      }
      days.set(e.date, d);
    }
    if (!days.size) continue;
    const tot = { work: 0, regular: 0, overtime: 0, leave: 0 };
    let first = true;
    for (const [date, d] of [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      for (const t of [tot, grand]) {
        t.work += d.work;
        t.regular += d.regular;
        t.overtime += d.overtime;
        t.leave += d.leave;
      }
      rows.push({
        cells: [first ? list[0]!.employeeName : "", mdy(date), weekday(date), clockTime(d.first), d.last === null ? "" : clockTime(d.last), d.work, d.regular, d.overtime, d.leave, d.work + d.leave],
        durationCols: D,
      });
      first = false;
    }
    rows.push({
      cells: [`Totals for ${list[0]!.employeeName}:`, "", "", "", "", tot.work, tot.regular, tot.overtime, tot.leave, tot.work + tot.leave],
      style: "total",
      durationCols: D,
    });
  }
  rows.push({ cells: [] });
  rows.push({
    cells: ["Control Totals:", "", "", "", "", grand.work, grand.regular, grand.overtime, grand.leave, grand.work + grand.leave],
    style: "grand",
    durationCols: D,
  });
  return {
    name: "Daily Times",
    widths: [25, 11, 8, 10, 10, 10, 10, 11.29, 10, 10],
    align: ["left", "center", "center", "center", "center", "right", "right", "right", "right", "right"],
    merges: ["A1:J1", "A2:J2"],
    rows,
  };
}

/**
 * One employee's hours for an inclusive business-date range: the Period
 * (Detail) sheet plus a daily times sheet. `entries` should start at the
 * Monday of `from`'s week so weekly overtime counts earlier days.
 */
export function buildEmployeeHoursWorkbook(
  employee: { name: string; salaried: boolean },
  entries: WorkbookEntry[],
  from: string,
  to: string,
): Buffer {
  return buildWorkbookXlsx([
    buildPeriodSheet({
      period: { start: from, end: to },
      entries,
      salariedNames: employee.salaried ? [employee.name] : [],
      notes: new Map(),
    }),
    buildDailySheet(entries, from, to),
  ]);
}
